import { promises as fs } from "fs";
import { addDays, format, subYears } from "date-fns";
import { DateArray, EventAttributes } from "ics";
import { Directus, PartialItem } from "@directus/sdk";
const ics = require("ics");

interface DirectusVenue {
  id: string;
  name: string;
  city?: string;
  address?: string;
  url?: string;
}

interface DirectusEvent {
  id: number;
  translations: {
    name: string;
    description: string;
    languages_code: string;
  }[];
  date_start: string;
  time_start: string;
  date_end: string;
  time_end: string;
  status: string;
  venue?: DirectusVenue;
  venue_other?: string;
  // image?: DirectusImage; // We don't use image in ICS
  url?: string;
  type?: number;
}

const yearsInThePast = 10;
const maxNumberOfEvent = 10000;
const cmsBaseUrl = "https://cms.tchoukball.ch";
const directus = new Directus<{ events: DirectusEvent }>(cmsBaseUrl);

const getEvents = async (): Promise<PartialItem<DirectusEvent>[]> => {
  console.log("Retrieving events...");
  const startDate = subYears(new Date(), yearsInThePast);

  const filter: any = {
    _and: [
      {
        status: {
          _neq: "draft",
        },
      },
      {
        date_start: {
          _gte: format(startDate, "yyyy-MM-dd"),
        },
      },
    ],
  };

  const eventsResponse = await directus.items("events").readByQuery({
    meta: "filter_count",
    limit: maxNumberOfEvent,
    page: 1,
    filter,
    fields: [
      "id",
      "translations.languages_code",
      "translations.name",
      "translations.description",
      "date_start",
      "time_start",
      "date_end",
      "time_end",
      "status",
      "venue.id",
      "venue.name",
      "venue.city",
      "venue.address",
      "venue_other",
      "url",
      "type",
    ],
    sort: ["date_start"],
  });

  if (eventsResponse?.meta?.filter_count) {
    console.log(`Retrieved ${eventsResponse.meta.filter_count} events`);
  }

  if (!eventsResponse?.data) {
    throw new Error("Error when retrieving events");
  }

  return eventsResponse.data.reduce((events, directusEvent) => {
    if (!directusEvent) {
      return events;
    }

    if (
      !directusEvent.id ||
      !directusEvent.date_start ||
      !directusEvent.date_end ||
      !directusEvent.translations ||
      !directusEvent.translations[0]?.name
    ) {
      console.warn(`Event with ID ${directusEvent.id} is missing requested fields`);
      return events;
    }

    return [...events, directusEvent];
  }, [] as PartialItem<DirectusEvent>[]);
};

const createIcsEvents = (events: PartialItem<DirectusEvent>[], language: "fr" | "de"): string => {
  console.log(`Creating ICS events in ${language}...`);

  const cancelledPrefix = language === "fr" ? "Annulé" : "Abgesagt";

  const processedEvents: EventAttributes[] = [];

  events.forEach((event) => {
    if (!event.id || !event.translations || !event.translations[0] || !event.date_start) {
      return;
    }

    let translation = event.translations[0];

    if (event.translations.length > 1) {
      const translationForLocale = event.translations?.find((t) => t?.languages_code === language);
      if (translationForLocale) {
        translation = translationForLocale;
      }
    }

    if (!translation.name) {
      return;
    }

    const isCancelled = event.status === "cancelled";

    let title = translation.name;
    if (isCancelled) {
      title = `[${cancelledPrefix}] ${title}`;
    }

    let isFullDay = true;

    let startDate = new Date(event.date_start);
    const start: DateArray = [startDate.getFullYear(), startDate.getMonth() + 1, startDate.getDate()];
    if (event.time_start) {
      const startTime = event.time_start.split(":").map((t) => parseInt(t));
      start.push(startTime[0], startTime[1]);
      isFullDay = false;
    }

    let endDate: Date;
    if (event.date_end) {
      endDate = new Date(event.date_end);
    } else if (isFullDay) {
      // For full day events, the endDate must be after the last day
      endDate = addDays(startDate, 1);
    } else {
      endDate = startDate;
    }
    const end: DateArray = [endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate()];
    if (!isFullDay && event.time_end) {
      const endTime = event.time_end.split(":").map((t) => parseInt(t));
      end.push(endTime[0], endTime[1]);
    }

    let location: string | undefined;
    if (event.venue) {
      location = `${event.venue.name}\n${event.venue.address}`;
    } else if (event.venue_other) {
      location = event.venue_other;
    }

    processedEvents.push({
      uid: `event-${event.id}@tchoukball.ch`,
      title,
      start,
      end,
      description: translation.description || undefined,
      location,
      url: event.url || undefined,
      status: isCancelled ? "CANCELLED" : "CONFIRMED",
      classification: "PUBLIC",
      calName: "Swiss Tchoukball",
    });
  });

  const { error, value: icsEvents } = ics.createEvents(processedEvents);

  if (error) {
    console.error(error);
    throw new Error("Couldn't create ICS events");
  }

  if (!icsEvents) {
    console.warn("No events!");
    return "";
  }

  return icsEvents;
};

const writeIcsFiles = async (icsEvents: string, name: string) => {
  console.log(`Writing ICS events ${name} to files...`);
  await fs.writeFile(`${__dirname}/../public/${name}.ics`, icsEvents);
};

const run = async () => {
  const events = await getEvents();
  const icsEventsFr = createIcsEvents(events, "fr");
  const icsEventsDe = createIcsEvents(events, "de");
  await writeIcsFiles(icsEventsFr, "events-fr");
  await writeIcsFiles(icsEventsDe, "events-de");
};

run();
