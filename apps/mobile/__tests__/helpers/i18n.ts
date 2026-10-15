import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

type Tree = { [key: string]: string | Tree };
export type Language = "en" | "es";
export type TestTranslate = (key: string, values?: Record<string, unknown>) => string;

const TREES: Record<Language, Tree> = { en: en as Tree, es: es as Tree };

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * A translator backed by the real locale files, mirroring the app's i18next v3
 * plural convention (`key` / `key_plural` chosen by `count`). A missing key
 * returns the key itself, so a screen that asks for a string no locale carries
 * fails loudly in assertions.
 */
export function makeTranslator(language: Language | (() => Language) = "en"): TestTranslate {
  return (key, values) => {
    const lang = typeof language === "function" ? language() : language;
    const count = values?.count;
    const plural = typeof count === "number" && count !== 1 ? lookup(TREES[lang], `${key}_plural`) : undefined;
    const template = plural ?? lookup(TREES[lang], key) ?? key;
    if (!values) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? `{{${name}}}`));
  };
}

export function localeHasKey(language: Language, key: string): boolean {
  return lookup(TREES[language], key) !== undefined;
}
