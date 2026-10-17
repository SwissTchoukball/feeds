import { writeFile } from "node:fs/promises";
import { createDirectus, readItems, rest } from "@directus/sdk";
import { Feed } from "feed";
import type { Enclosure } from "feed";

interface DirectusNews {
  id: number;
  date_created: string;
  date_updated: string;
  main_image: {
    id: string;
    description: string;
    type: string;
    filesize: string;
    author_name?: string;
  };
  translations: {
    languages_code: string;
    slug: string;
    title: string;
    body: string;
    main_image_caption?: string;
  }[];
}

const websiteBaseUrl = "https://tchoukball.ch";
const cmsBaseUrl = "https://cms.tchoukball.ch";
const directus = createDirectus<{ news: DirectusNews[] }>(cmsBaseUrl).with(rest());

const getPosts = async (locale: "fr" | "de"): Promise<DirectusNews[]> => {
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

  const news = (await directus.request(
    readItems("news", {
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
        "main_image.author_name",
        "translations.languages_code",
        "translations.slug",
        "translations.title",
        "translations.body",
        "translations.main_image_caption",
      ] as any,
      sort: ["-date_created"],
    } as any)
  )) as unknown as DirectusNews[];

  return news.reduce((news, directusNewsEntry) => {
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
  }, [] as DirectusNews[]);
};

const getFirstParagraphText = (html: string): string => {
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const innerHtml = match ? match[1] : html;
  return innerHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const createFeed = (posts: DirectusNews[], language: "fr" | "de"): Feed => {
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

  posts.forEach((post: DirectusNews) => {
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
      let figure = `<figure><img src="${cmsBaseUrl}/assets/${post.main_image.id}/?width=1400" />`;
      const caption = translation.main_image_caption;
      const author = post.main_image.author_name;
      if (caption || author) {
        figure += "<figcaption>";
        if (caption) {
          figure += caption;
        }
        if (caption && author) {
          figure += " ";
        }
        if (author) {
          figure += `– Photo : ${author}`;
        }
        figure += "</figcaption>";
      }
      figure += "</figure>";
      content = figure + content;
    }

    feed.addItem({
      title: translation.title || "No title",
      id: url,
      link: url,
      description: getFirstParagraphText(translation.body || ""),
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
  await writeFile(`${import.meta.dirname}/../public/${name}.xml`, feed.rss2());
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
