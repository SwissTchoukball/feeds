import { promises as fs } from "fs";
import { Directus, PartialItem } from "@directus/sdk";
import { Feed } from "feed";
import { Enclosure } from "feed/lib/typings";

interface DirectusNews {
  id: number;
  date_created: string;
  date_updated: string;
  main_image: {
    id: string;
    description: string;
    type: string;
    filesize: string;
  };
  translations: {
    languages_code: string;
    slug: string;
    title: string;
    body: string;
  }[];
}

const websiteBaseUrl = "https://tchoukball.ch";
const cmsBaseUrl = "https://cms.tchoukball.ch";
const directus = new Directus<{ news: DirectusNews }>(cmsBaseUrl);

const getPosts = async (locale: "fr" | "de"): Promise<PartialItem<DirectusNews>[]> => {
  console.log("Retrieving posts...");

  const filter: any = {
    _and: [
      {
        status: {
          _eq: "published",
        },
      },
    ],
  };

  const newsResponse = await directus.items("news").readByQuery({
    meta: "filter_count",
    limit: 25,
    page: 1,
    filter,
    fields: [
      "id",
      "date_created",
      "date_updated",
      "main_image.id",
      "main_image.description",
      "main_image.type",
      "main_image.filesize",
      "translations.languages_code",
      "translations.slug",
      "translations.title",
      "translations.body",
    ],
    deep: {
      // @ts-ignore Bug with Directus SDK, which expects `filter` instead of `_filter`. It doesn't work with `filter`.
      domains: { domains_id: { translations: { _filter: { languages_code: { _eq: locale } } } } },
    },
    sort: ["-date_created"],
  });

  if (!newsResponse?.data) {
    throw new Error("Error when retrieving news");
  }

  return newsResponse.data.reduce((news, directusNewsEntry) => {
    if (!directusNewsEntry) {
      return news;
    }

    if (
      !directusNewsEntry.id ||
      !directusNewsEntry.date_created ||
      !directusNewsEntry.translations ||
      !directusNewsEntry.translations[0]?.title
    ) {
      console.warn(`News entry with ID ${directusNewsEntry.id} is missing requested fields`);
      return news;
    }

    return [...news, directusNewsEntry];
  }, [] as PartialItem<DirectusNews>[]);
};

const createFeed = (posts: PartialItem<DirectusNews>[], language: "fr" | "de"): Feed => {
  console.log(`Creating feed in ${language}...`);
  const feed = new Feed({
    title: "Swiss Tchoukball",
    description: language === "de" ? "News von Swiss Tchoukball" : "Actualités de Swiss Tchoukball",
    id: websiteBaseUrl,
    link: `${websiteBaseUrl}/news`,
    language: language, // optional, used only in RSS 2.0, possible values: http://www.w3.org/TR/REC-html40/struct/dirlang.html#langcodes
    image: `${websiteBaseUrl}/images/og-swiss-tchoukball.jpg`,
    favicon: `${websiteBaseUrl}/favicon.ico`,
    copyright:
      `© ${new Date().getFullYear()} Swiss Tchoukball, ` +
      (language === "de" ? "alle Rechte vorbehalten" : "tous droits réservés"),
    author: {
      name: "Swiss Tchoukball",
      email: "info@tchoukball.ch",
      link: websiteBaseUrl,
    },
  });

  posts.forEach((post: PartialItem<DirectusNews>) => {
    if (!post.translations || !post.translations[0]) {
      return;
    }

    let translation = post.translations[0];

    if (post.translations.length > 1) {
      const translationForLocale = post.translations?.find((t) => t?.languages_code === language);
      if (translationForLocale) {
        translation = translationForLocale;
      }
    }

    let url = `${websiteBaseUrl}/news/${post.id}`;
    url += translation.slug ? `-${translation.slug}` : "";

    let content: string = translation.body || "";
    let image: string | Enclosure | undefined = undefined;
    if (post.main_image) {
      image = {
        url: `${cmsBaseUrl}/assets/${post.main_image.id}/?width=1400`,
        type: post.main_image.type,
        length: parseInt(post.main_image.filesize || "0"),
      };
      content = `<p><img src="${cmsBaseUrl}/assets/${post.main_image.id}/?width=1400" /></p>` + content;
    }

    feed.addItem({
      title: translation.title || "No title",
      id: url,
      link: url,
      description: "This is the description",
      content,
      author: [
        {
          name: "Swiss Tchoukball",
          email: "info@tchoukball.ch",
          link: websiteBaseUrl,
        },
      ],
      //   TODO: Include photographer and actual news writer
      //   contributor: [
      //     {
      //       name: "Shawn Kemp",
      //       email: "shawnkemp@example.com",
      //       link: "https://example.com/shawnkemp",
      //     },
      //     {
      //       name: "Reggie Miller",
      //       email: "reggiemiller@example.com",
      //       link: "https://example.com/reggiemiller",
      //     },
      //   ],
      date: post.date_created ? new Date(post.date_created) : new Date(),
      image,
    });
  });

  feed.addCategory("Sports");
  feed.addCategory("Tchoukball");

  return feed;
};

const writeFeedFiles = async (feed: Feed, name: string) => {
  console.log(`Writing feed ${name} to files...`);
  await fs.writeFile(`public/${name}.xml`, feed.rss2());
};

const run = async () => {
  const postsFr = await getPosts("fr");
  const postsDe = await getPosts("de");
  const feedFr = createFeed(postsFr, "fr");
  const feedDe = createFeed(postsDe, "de");
  await writeFeedFiles(feedFr, "news-fr");
  await writeFeedFiles(feedDe, "news-de");
};

run();
