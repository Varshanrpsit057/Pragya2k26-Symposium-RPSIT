/**
 * The staff logins as a Word document (.docx), made in the browser the moment the passwords are
 * made (they are shown once and only their hash is stored): a title, how to hand them out, then
 * each department's sign-in page and a table of role, what for, username and password. Built with
 * the project's own zip writer (src/lib/xlsx.ts): no library, nothing sent anywhere.
 */
import { zip } from '../lib/xlsx';

export interface LoginRow {
  role: string;
  /** The desk, the event or the department. */
  for: string;
  username: string;
  password: string;
}

export interface LoginGroup {
  title: string;
  signInAt: string;
  rows: LoginRow[];
}

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NAVY = '1B1C5C';
const ACCENT = '3437A0';
const MUTED = '555A75';
/** A4 portrait with 2 cm margins: 9638 twentieths of a point of text width. */
const WIDTH = 9638;
const COLUMNS = [560, 2050, 2700, 2328, 2000];

/** Text as XML (characters XML cannot hold are dropped). */
const esc = (value: string) =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
  mono?: boolean;
}
const run = (text: string, style: RunStyle = {}) =>
  `<w:r><w:rPr>${style.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : ''}${style.bold ? '<w:b/>' : ''}${style.italic ? '<w:i/>' : ''}${
    style.color ? `<w:color w:val="${style.color}"/>` : ''
  }${style.size ? `<w:sz w:val="${style.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const paragraph = (runs: string, { style, after = 120, keepNext = false }: { style?: string; after?: number; keepNext?: boolean } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const cell = (text: string, width: number, { header = false, mono = false } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EAF6"/>' : ''}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${
    text ? run(text, { bold: header, color: header ? NAVY : undefined, mono }) : ''
  }</w:p></w:tc>`;

function table(rows: LoginRow[]) {
  const grid = COLUMNS.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const line = '<w:top w:val="single" w:sz="4" w:color="B8BCD8"/><w:left w:val="single" w:sz="4" w:color="B8BCD8"/><w:bottom w:val="single" w:sz="4" w:color="B8BCD8"/><w:right w:val="single" w:sz="4" w:color="B8BCD8"/><w:insideH w:val="single" w:sz="4" w:color="B8BCD8"/><w:insideV w:val="single" w:sz="4" w:color="B8BCD8"/>';
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${['#', 'Role', 'For', 'Username', 'Password'].map((title, index) => cell(title, COLUMNS[index]!, { header: true })).join('')}</w:tr>`;
  const body = rows
    .map(
      (row, index) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(String(index + 1), COLUMNS[0]!)}${cell(row.role, COLUMNS[1]!)}${cell(row.for, COLUMNS[2]!)}${cell(row.username, COLUMNS[3]!, { mono: true })}${cell(row.password, COLUMNS[4]!, { mono: true })}</w:tr>`,
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${WIDTH}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${line}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>`;
}

/** The document's body: the title, how to hand the logins out, then a page per group. */
function documentXml(groups: LoginGroup[], subtitle: string) {
  const parts: string[] = [
    paragraph(run('INFINITE TECHFEST’26', { bold: true, color: ACCENT, size: 22 }), { after: 40 }),
    paragraph(run('On-site Registration Portal: staff logins', { bold: true, color: NAVY, size: 40 }), { style: 'Title', after: 80 }),
    paragraph(run(subtitle, { color: MUTED }), { after: 200 }),
    paragraph(run('Give each person only their own row, privately (in person or a direct message). Never post this document in a group; keep it safe and delete it after the fest.', { bold: true })),
    paragraph(run('Each password works until it is changed. A forgotten password: Accounts → the person → new password. A lost phone: Accounts → Sign out.', { color: MUTED }), { after: 240 }),
  ];
  groups.forEach((group, index) => {
    if (index > 0) parts.push(pageBreak);
    parts.push(
      paragraph(run(group.title, { bold: true, color: NAVY, size: 28 }), { style: 'Heading1', after: 60, keepNext: true }),
      paragraph(run('Sign in at ') + run(group.signInAt, { bold: true }) + run(` · ${group.rows.length} account${group.rows.length === 1 ? '' : 's'}`, { color: MUTED }), { keepNext: true }),
      table(group.rows),
      paragraph('', { after: 120 }),
    );
  });
  const section = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${parts.join('')}${section}</w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`;

const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run('CONFIDENTIAL · staff logins', { bold: true, color: '9A9DB8', size: 16 })}</w:p></w:hdr>`;
const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('INFINITE TECHFEST’26 · On-site Registration Portal · page ', { color: '9A9DB8', size: 16 })}<w:r><w:rPr><w:color w:val="9A9DB8"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:color w:val="9A9DB8"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:color w:val="9A9DB8"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="9A9DB8"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:color w:val="9A9DB8"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
const core = (date: Date) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>INFINITE TECHFEST’26 · On-site Registration Portal: staff logins</dc:title><dc:creator>Web assist team</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${date.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

/** The .docx file's bytes. */
export function buildLoginsDoc(groups: LoginGroup[], subtitle: string, date = new Date()): Uint8Array<ArrayBuffer> {
  const encode = (text: string) => new TextEncoder().encode(text);
  return zip(
    [
      ['[Content_Types].xml', encode(CONTENT_TYPES)],
      ['_rels/.rels', encode(ROOT_RELS)],
      ['docProps/core.xml', encode(core(date))],
      ['word/document.xml', encode(documentXml(groups, subtitle))],
      ['word/_rels/document.xml.rels', encode(DOCUMENT_RELS)],
      ['word/styles.xml', encode(STYLES)],
      ['word/header1.xml', encode(header)],
      ['word/footer1.xml', encode(footer)],
    ],
    date,
  );
}
