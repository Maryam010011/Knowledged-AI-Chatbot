import pdfParse from 'pdf-parse';

export interface ExtractedPdf {
  text: string;
  numpages: number;
  info?: any;
}

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<ExtractedPdf> {
  try {
    const data = await pdfParse(buffer, {
      // Best effort text rendering options
      pagerender: (pageData: any) => {
        return pageData.getTextContent().then((textContent: any) => {
          let lastY: number | null = null;
          let text = '';
          for (const item of textContent.items) {
            if (lastY === null || Math.abs(lastY - item.transform[5]) > 5) {
              text += '\n' + item.str;
            } else {
              text += ' ' + item.str;
            }
            lastY = item.transform[5];
          }
          return text;
        });
      }
    });

    return {
      text: data.text,
      numpages: data.numpages,
      info: data.info,
    };
  } catch (error: any) {
    console.error('Error parsing PDF:', error);
    throw new Error(`Failed to extract text from PDF: ${error?.message || error}`);
  }
}
