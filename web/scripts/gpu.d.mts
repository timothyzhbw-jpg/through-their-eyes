import type { Browser, Page } from "playwright-core";

export function launchChrome(options?: {
  headless?: boolean;
  software?: boolean;
}): Promise<Browser>;
export function rendererOf(page: Page): Promise<string>;
export function serveTestPage(page: string): Promise<{ url: string; close: () => Promise<void> }>;
