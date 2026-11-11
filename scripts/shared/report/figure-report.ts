import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { WorkspacePaths } from '../common/workspace-paths.js';
import { ReportData } from './report-data.js';
import { ReportImages } from './report-images.js';
import { reportPage } from './report-page.js';

const REPORT_FILE = 'figures-report.pdf';

/**
 * Writes the figure review PDF to resources/figures-report.pdf after every pipeline run, so it always shows every
 * figure as it is now. It is written beside the target and renamed into place, so parallel runs never leave a half
 * written file.
 */
export class FigureReport {
  public static async write(): Promise<string> {
    const content = ReportData.read();
    const figures = await Promise.all(content.figures.map(async (figure) => ({
      figure,
      images: await ReportImages.of(figure.id),
    })));
    const target = join(WorkspacePaths.resourcesDir, REPORT_FILE);
    const draft = `${target}.${process.pid}.tmp`;
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage();
      await page.setContent(reportPage(content, figures, new Date()), { waitUntil: 'load' });
      await page.pdf({ path: draft, format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close();
    }
    renameSync(draft, target);
    return target;
  }
}

if (process.argv[1]?.endsWith('figure-report.ts')) {
  FigureReport.write()
    .then((path) => console.log(`Report written to ${path}`))
    .catch((error: unknown) => {
      console.error(`Report failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
