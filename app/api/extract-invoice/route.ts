import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type ExtractedLine = {
  upc: string;
  name: string;
  department: string;
  vendor: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
};

type PdfTextRun = {
  T?: string;
};

type PdfTextItem = {
  x?: number;
  y?: number;
  R?: PdfTextRun[];
};

type PdfPage = {
  Texts?: PdfTextItem[];
};

type PdfData = {
  Pages?: PdfPage[];
};

function safeNumber(value: string | number | undefined, fallback = 0) {
  const cleaned = String(value ?? '')
    .replace(/[$,]/g, '')
    .trim();

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decodePdfText(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function guessDepartment(productName: string) {
  const name = productName.toLowerCase();

  if (
    name.includes('coke') ||
    name.includes('pepsi') ||
    name.includes('water') ||
    name.includes('gatorade') ||
    name.includes('red bull') ||
    name.includes('monster') ||
    name.includes('sprite') ||
    name.includes('dr pepper') ||
    name.includes('mountain dew')
  ) {
    return 'Beverages';
  }

  if (
    name.includes('doritos') ||
    name.includes('lays') ||
    name.includes('chips') ||
    name.includes('cheetos') ||
    name.includes('pringles') ||
    name.includes('fritos') ||
    name.includes('ruffles')
  ) {
    return 'Snacks';
  }

  if (
    name.includes('snickers') ||
    name.includes('rees') ||
    name.includes('m&m') ||
    name.includes('kit kat') ||
    name.includes('hershey') ||
    name.includes('candy') ||
    name.includes('gum')
  ) {
    return 'Candy';
  }

  if (
    name.includes('marlboro') ||
    name.includes('newport') ||
    name.includes('cigarette') ||
    name.includes('lighter') ||
    name.includes('camel')
  ) {
    return 'Tobacco';
  }

  if (
    name.includes('bud') ||
    name.includes('miller') ||
    name.includes('corona') ||
    name.includes('beer') ||
    name.includes('modelo')
  ) {
    return 'Beer';
  }

  return 'General Merchandise';
}

function extractVendor(text: string) {
  const firstLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);

  return firstLines[0] || '';
}

function shouldSkipLine(line: string) {
  const lower = line.toLowerCase();

  const skipWords = [
    'invoice',
    'subtotal',
    'total due',
    'balance',
    'tax',
    'date',
    'page',
    'terms',
    'remit',
    'ship to',
    'bill to',
    'customer',
    'account',
    'phone',
    'fax',
    'email',
    'address',
    'sales rep',
    'signature',
    'thank you',
    'amount due',
    'grand total',
  ];

  return skipWords.some((word) => lower.includes(word));
}

function cleanProductName(line: string, numbers: string[], upc: string) {
  let productName = line;

  if (upc) {
    productName = productName.replace(upc, '');
  }

  for (const numberText of numbers) {
    productName = productName.replace(numberText, '');
  }

  return productName
    .replace(/\b(qty|quantity|case|pack|each|ea|ct|total|cost|price|amount|ext|item|code|upc|sku)\b/gi, '')
    .replace(/[#:$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseInvoiceText(text: string): ExtractedLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const vendor = extractVendor(text);
  const extracted: ExtractedLine[] = [];

  for (const line of lines) {
    if (shouldSkipLine(line)) continue;

    const possibleUpc = line.match(/\b\d{8,14}\b/)?.[0] || '';
    const lineWithoutUpc = possibleUpc ? line.replace(possibleUpc, '') : line;

    const numbers = lineWithoutUpc.match(/\$?\d+(?:,\d{3})*(?:\.\d{1,4})?/g) || [];

    if (numbers.length < 2) continue;

    const numericValues = numbers.map((value) => safeNumber(value)).filter((value) => value > 0);

    if (numericValues.length < 2) continue;

    const totalCost = numericValues[numericValues.length - 1] || 0;
    const unitCost = numericValues[numericValues.length - 2] || 0;

    let quantity = 1;

    for (const value of numericValues) {
      if (value > 0 && value < 10000 && Number.isInteger(value)) {
        quantity = value;
        break;
      }
    }

    const productName = cleanProductName(line, numbers, possibleUpc);

    if (!productName || productName.length < 3) continue;
    if (unitCost <= 0 && totalCost <= 0) continue;

    extracted.push({
      upc: possibleUpc,
      name: productName,
      department: guessDepartment(productName),
      vendor,
      quantity,
      unitCost,
      totalCost: totalCost || quantity * unitCost,
    });
  }

  return extracted.slice(0, 150);
}

function getTextFromItem(textItem: PdfTextItem) {
  return (
    textItem.R?.map((run) => decodePdfText(run.T || ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim() || ''
  );
}

function buildLinesFromPdfData(pdfData: PdfData) {
  const allLines: string[] = [];

  for (const page of pdfData.Pages || []) {
    const textItems = (page.Texts || [])
      .map((item) => ({
        x: item.x ?? 0,
        y: item.y ?? 0,
        text: getTextFromItem(item),
      }))
      .filter((item) => item.text);

    textItems.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.3) return a.y - b.y;
      return a.x - b.x;
    });

    const rows: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

    for (const item of textItems) {
      const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= 0.25);

      if (existingRow) {
        existingRow.items.push({ x: item.x, text: item.text });
      } else {
        rows.push({
          y: item.y,
          items: [{ x: item.x, text: item.text }],
        });
      }
    }

    for (const row of rows) {
      const rowText = row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (rowText) allLines.push(rowText);
    }
  }

  return allLines.join('\n');
}

function extractPdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PDFParser = require('pdf2json');
      const pdfParser = new PDFParser();

      pdfParser.on('pdfParser_dataError', (errorData: { parserError?: Error }) => {
        reject(errorData.parserError || new Error('PDF parsing failed.'));
      });

      pdfParser.on('pdfParser_dataReady', (pdfData: PdfData) => {
        const text = buildLinesFromPdfData(pdfData);
        resolve(text);
      });

      pdfParser.parseBuffer(buffer);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('PDF parser failed.'));
    }
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No invoice file received.' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const mimeType = file.type || '';

    if (!fileName.endsWith('.pdf') && mimeType !== 'application/pdf') {
      return NextResponse.json(
        {
          error: 'This extractor currently supports CSV and text-based PDF. Photo OCR is the next low-cost step.',
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractPdfText(buffer);

    if (!text.trim()) {
      return NextResponse.json(
        {
          error: 'No readable text found in this PDF. This is probably a scanned invoice or photo PDF. OCR will be added next.',
        },
        { status: 400 }
      );
    }

    const lines = parseInvoiceText(text);

    return NextResponse.json({
      textPreview: text.slice(0, 1500),
      lines,
      message: lines.length
        ? `${lines.length} invoice lines extracted.`
        : `Text was found, but no invoice product lines matched the current parser. Preview: ${text
            .slice(0, 400)
            .replace(/\s+/g, ' ')}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Could not extract invoice.',
      },
      { status: 500 }
    );
  }
}