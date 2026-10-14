/**
 * A small Word (.docx) writer for the dashboard's printouts: a title, then sections, each a
 * heading, a note and a table (bordered, the header row repeated on every page), optionally on a
 * page of its own. Cells may be links. No library: the files are written as XML and zipped like
 * the Excel downloads (src/lib/xlsx.ts).
 */
import { zip } from './xlsx';

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A cell: text, or a link (shown as its text, opening `href`). */
export type DocCell = string | { text: string; href: string };

export interface DocTable {
  heading: string;
  note?: string;
  columns: { title: string; width: number; mono?: boolean }[];
  rows: DocCell[][];
  /** Starts on a new page (every section after the first). */
  newPage?: boolean;
}

export interface DocContent {
  title: string;
  subtitle?: string;
  sections: DocTable[];
  landscape?: boolean;
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
const paragraph = (inner: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;

/** The document's XML and the links it uses (each needs a relationship). */
export function documentXml(content: DocContent): { xml: string; links: string[] } {
  const links: string[] = [];
  const linkRun = (cell: { text: string; href: string }) => {
    links.push(cell.href);
    return `<w:hyperlink r:id="rLink${links.length}">${run(cell.text, '<w:color w:val="1F4FBF"/><w:u w:val="single"/>')}</w:hyperlink>`;
  };
  const cellXml = (cell: DocCell, width: number, header: boolean, mono: boolean) => {
    const text = typeof cell === 'string' ? cell : cell.text;
    const props = `${header ? '<w:b/>' : ''}${mono && !header ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}`;
    const inner = typeof cell !== 'string' && !header ? linkRun(cell) : run(text, props);
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="DDE2F6"/>' : ''}</w:tcPr>${paragraph(inner, '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
  };
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="8A90A6"/>`;
  const table = (section: DocTable) =>
    // (The order of these elements is fixed by the format: Word refuses a file that changes it.)
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid>${section.columns.map((column) => `<w:gridCol w:w="${column.width}"/>`).join('')}</w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${section.columns.map((column) => cellXml(column.title, column.width, true, false)).join('')}</w:tr>` +
    section.rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${section.columns.map((column, index) => cellXml(row[index] ?? '', column.width, false, Boolean(column.mono))).join('')}</w:tr>`).join('') +
    `</w:tbl>`;

  const body = [
    paragraph(run(content.title, '<w:b/><w:sz w:val="34"/>'), '<w:spacing w:after="60"/>'),
    ...(content.subtitle ? [paragraph(run(content.subtitle, '<w:color w:val="5B6275"/>'), '<w:spacing w:after="200"/>')] : []),
    ...content.sections.flatMap((section, index) => [
      paragraph(run(section.heading, '<w:b/><w:sz w:val="28"/>'), `<w:keepNext/>${section.newPage && index > 0 ? '<w:pageBreakBefore/>' : ''}<w:spacing w:before="240" w:after="80"/>`),
      ...(section.note ? [paragraph(run(section.note, '<w:color w:val="5B6275"/>'), '<w:keepNext/><w:spacing w:after="120"/>')] : []),
      table(section),
      paragraph(''),
    ]),
  ].join('');
  const page = content.landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${body}<w:sectPr>${page}<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return { xml, links };
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

/** The .docx file. */
export function buildDocx(content: DocContent, date = new Date()): Uint8Array<ArrayBuffer> {
  const { xml, links } = documentXml(content);
  const encoder = new TextEncoder();
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    ['word/document.xml', xml],
    [
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        links.map((href, index) => `<Relationship Id="rLink${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(href)}" TargetMode="External"/>`).join('') +
        '</Relationships>',
    ],
    ['word/styles.xml', STYLES],
  ];
  return zip(
    files.map(([name, text]) => [name, encoder.encode(text)]),
    date,
  );
}
