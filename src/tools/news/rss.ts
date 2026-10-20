import { XMLParser, XMLValidator } from "fast-xml-parser";

type XmlObject = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (tagName) => tagName === "item",
});

function object(value: unknown): XmlObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlObject)
    : null;
}

export function field(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  const text = object(value)?.["#text"];
  return typeof text === "string" ? text.trim() || null : null;
}

export function attribute(value: unknown, name: string): string | null {
  return field(object(value)?.[`@_${name}`]);
}

export type RssFeed = { channel: XmlObject; items: XmlObject[] };

/** XML 형식과 RSS 구조를 확인합니다. 빈 item 목록은 호출자가 실패로 처리합니다. */
export function parseRss(xml: string): RssFeed {
  if (!xml.trim()) throw new Error("RSS 응답이 비어 있습니다.");
  if (xml.length > 1_000_000) throw new Error("RSS 응답이 허용 크기(100만 자)를 넘었습니다.");
  if (/<!DOCTYPE\b/i.test(xml)) throw new Error("DOCTYPE 이 포함된 RSS는 처리하지 않습니다.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`RSS XML 형식이 잘못되었습니다: ${validation.err.msg}`);
  }

  const root = object(parser.parse(xml));
  const rawChannel = object(root?.rss)?.channel;
  const channel = object(rawChannel) ?? (rawChannel === "" ? {} : null);
  if (!channel) throw new Error("RSS channel 을 찾지 못했습니다.");
  const rawItems = channel.item;
  const items = rawItems === undefined ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];
  if (items.some((item) => !object(item))) throw new Error("RSS item 구조가 잘못되었습니다.");
  return { channel, items: items as XmlObject[] };
}
