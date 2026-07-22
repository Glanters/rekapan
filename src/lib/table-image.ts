import { toPng } from 'html-to-image';

/** The page background, so a captured image is never transparent. */
function resolveBackground(): string {
  for (const element of [document.body, document.documentElement]) {
    const background = getComputedStyle(element).backgroundColor;
    if (
      background &&
      background !== 'transparent' &&
      !background.startsWith('rgba(0, 0, 0, 0')
    ) {
      return background;
    }
  }
  return '#ffffff';
}

/**
 * Renders an element to a PNG and triggers a download.
 *
 * The report tables live inside a horizontal/vertical scroll container, so the
 * caller passes the `<table>` itself rather than the clipped wrapper — the table
 * has no scroll of its own, so every row and column lands in the image at full
 * size. The active theme's background is baked in, and a 2× pixel ratio keeps
 * the text crisp.
 */
export async function downloadTableImage(
  node: HTMLElement,
  filename: string,
): Promise<void> {
  const dataUrl = await toPng(node, {
    backgroundColor: resolveBackground(),
    pixelRatio: 2,
    // Drop anything marked for exclusion — the action column, whose buttons are
    // meaningless in a static image. Removing the cells from every row leaves
    // the column gone entirely rather than blank. Text nodes have no
    // `hasAttribute`, hence the element guard.
    filter: (element) =>
      !(element instanceof HTMLElement) ||
      !element.hasAttribute('data-capture-exclude'),
  });

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}
