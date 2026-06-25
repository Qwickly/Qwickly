import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfTextItem = {
  str?: string;
};

export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const document = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (item as PdfTextItem).str ?? "")
      .filter(Boolean)
      .join("\n");

    pages.push(pageText);
  }

  return pages.join("\n");
}
