/**
 * The PRAGYA 2026 participant pass: an A4 PDF made after a successful registration.
 *
 * The registration server attaches it to the confirmation email and saves it to Google
 * Drive; the website builds the very same file for the "Download pass" button. It uses
 * only the PDF standard fonts, so it stays small and fast to make.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import { eventCatalog } from '../content/eventCatalog';
import { eventInfo } from '../content/eventInfo';
import { site } from '../content/site';
import type { EventCategory } from '../content/types';
import type { ParticipantDetails, RegistrationRecord } from './registration';

export interface PassEvent {
  id: string;
  name: string;
  subtitle?: string;
  category: EventCategory;
  description: string;
  /** e.g. 'Technical · Team event' */
  type?: string;
  team?: string;
  venue: string;
  date: string;
  timing: string;
}

export interface PassData {
  registrationId: string;
  /** ISO 8601 */
  registeredAt: string;
  participant: ParticipantDetails;
  transactionId: string;
  /** Only the events this participant selected, in the site's order. */
  events: PassEvent[];
  amountPaid: number;
  feePerEvent: number;
  /** events.length × feePerEvent, paid on the spot. */
  payableAtVenue: number;
}

const TO_BE_ANNOUNCED = 'To be announced';
const CATEGORY_LABEL: Record<EventCategory, string> = { technical: 'Technical', 'non-technical': 'Non-Technical' };

/** Everything the pass shows, from a stored registration and the site's event details. */
export function passData(input: {
  registrationId: string;
  registeredAt: string;
  record: RegistrationRecord;
  eventIds: readonly string[];
}): PassData {
  const { record } = input;
  const events = eventCatalog
    .filter((event) => input.eventIds.includes(event.id))
    .map((event) => {
      const info = eventInfo[event.id];
      return {
        id: event.id,
        name: event.name,
        subtitle: event.subtitle && !event.name.toLowerCase().includes(event.subtitle.toLowerCase()) ? event.subtitle : undefined,
        category: event.category,
        description: event.description,
        type: info?.type,
        team: event.teamSize ?? info?.team,
        venue: event.venue ?? site.venue ?? `${site.college.name}, Salem`,
        date: site.dates ?? TO_BE_ANNOUNCED,
        timing: event.schedule ?? TO_BE_ANNOUNCED,
      };
    });
  const feePerEvent = record.eventRegistration.feePerEvent;
  return {
    registrationId: input.registrationId,
    registeredAt: input.registeredAt,
    participant: record.participant,
    transactionId: record.payment.transactionId,
    events,
    amountPaid: record.payment.gatePassAmount,
    feePerEvent,
    payableAtVenue: events.length * feePerEvent,
  };
}

export const passFileName = (registrationId: string) => `PRAGYA-2026-Pass-${registrationId}.pdf`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '6 October 2026, 7:35 PM IST' — worked out by hand so it is the same on every device. */
export function formatIstDateTime(iso: string): string {
  const ist = new Date(Date.parse(iso) + 5.5 * 3_600_000);
  if (Number.isNaN(ist.getTime())) return iso;
  const hours = ist.getUTCHours();
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'} IST`;
}

/** One formatter for every amount: building it is the costly part of formatting. */
const inr = new Intl.NumberFormat('en-IN');
const rupees = (amount: number) => `₹${inr.format(amount)}`;

// ---------------------------------------------------------------------------------------
// Drawing

const PAGE = { width: 595.28, height: 841.89 }; // A4 in points
const MARGIN = 36;
const CONTENT = PAGE.width - MARGIN * 2;
const FOOTER_SPACE = 58;

const COLOR = {
  ink: rgb(0.075, 0.09, 0.24),
  muted: rgb(0.37, 0.39, 0.5),
  line: rgb(0.83, 0.84, 0.91),
  violet: rgb(0.35, 0.24, 0.84),
  violetSoft: rgb(0.95, 0.94, 1),
  pink: rgb(0.82, 0.2, 0.55),
  green: rgb(0.05, 0.52, 0.3),
  greenSoft: rgb(0.89, 0.97, 0.92),
  amber: rgb(0.68, 0.38, 0),
  amberSoft: rgb(1, 0.965, 0.87),
  amberLine: rgb(0.9, 0.64, 0.2),
  white: rgb(1, 1, 1),
};

/** Material Icons "currency_rupee" (Apache License 2.0), drawn as a shape because the PDF standard fonts have no ₹. */
const RUPEE_PATH =
  'M13.66 7c-.56-1.18-1.76-2-3.16-2H6V3h12v2h-3.26c.48.58.84 1.26 1.05 2H18v2h-2.02c-.25 2.8-2.61 5-5.48 5h-.73l6.73 7h-2.77L7 14v-2h3.5c1.76 0 3.22-1.3 3.46-3H6V7h7.66z';
const RUPEE_ADVANCE = 0.6;

/** Characters the standard fonts can show (Windows-1252) besides plain ASCII and Latin-1. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const printable = (text: string) =>
  text
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, (char) => (WIN_ANSI_EXTRA.includes(char) ? char : '?'));

interface TextStyle {
  font: PDFFont;
  size: number;
  color?: RGB;
}

function measure(text: string, { font, size }: TextStyle): number {
  const parts = text.split('₹');
  return parts.reduce((width, part) => width + font.widthOfTextAtSize(printable(part), size), 0) + (parts.length - 1) * RUPEE_ADVANCE * size;
}

function drawRupee(page: PDFPage, x: number, y: number, size: number, color: RGB) {
  // The glyph spans y 3–21 of a 24-unit box; scale it to the font's capital height.
  const scale = (0.72 * size) / 18;
  page.drawSvgPath(RUPEE_PATH, { x: x - 6 * scale + 0.05 * size, y: y + 21 * scale, scale, color });
}

/** Draws one line of text (₹ included) with its left edge at x and baseline at y. */
function write(page: PDFPage, text: string, x: number, y: number, style: TextStyle) {
  const { font, size, color = COLOR.ink } = style;
  let cursor = x;
  text.split('₹').forEach((part, index) => {
    if (index > 0) {
      drawRupee(page, cursor, y, size, color);
      cursor += RUPEE_ADVANCE * size;
    }
    const clean = printable(part);
    if (clean) {
      page.drawText(clean, { x: cursor, y, size, font, color });
      cursor += font.widthOfTextAtSize(clean, size);
    }
  });
}

const writeCentered = (page: PDFPage, text: string, y: number, style: TextStyle) =>
  write(page, text, (PAGE.width - measure(text, style)) / 2, y, style);

const writeRight = (page: PDFPage, text: string, right: number, y: number, style: TextStyle) =>
  write(page, text, right - measure(text, style), y, style);

/** Splits text into lines no wider than maxWidth (very long words, such as emails, are broken). */
function wrap(text: string, style: TextStyle, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, style) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let rest = word;
    while (measure(rest, style) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), style) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** A rectangle with rounded corners; y is its bottom edge. */
function roundedBox(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  { fill, border, borderWidth = 0.8 }: { fill?: RGB; border?: RGB; borderWidth?: number },
) {
  const r = Math.min(radius, width / 2, height / 2);
  const path =
    `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} ` +
    `H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`;
  page.drawSvgPath(path, {
    x,
    y: y + height,
    color: fill,
    borderColor: border,
    borderWidth: border ? borderWidth : 0,
  });
}

class PassLayout {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  /** The next free line, measured from the bottom of the page. */
  y = 0;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;

  constructor(
    private readonly pdf: PDFDocument,
    fonts: { regular: PDFFont; bold: PDFFont },
    private readonly logo: PDFImage,
    private readonly data: PassData,
  ) {
    this.regular = fonts.regular;
    this.bold = fonts.bold;
  }

  private style(size: number, bold = false, color: RGB = COLOR.ink): TextStyle {
    return { font: bold ? this.bold : this.regular, size, color };
  }

  addPage() {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN;
    if (this.pages.length === 1) this.header();
    else this.continuationHeader();
  }

  /** Starts a new page when the next block would run into the footer. */
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_SPACE) this.addPage();
  }

  private header() {
    const { page } = this;
    const top = this.y;
    const logoHeight = 84;
    const logoSize = this.logo.scale(logoHeight / this.logo.height);
    page.drawImage(this.logo, { x: MARGIN, y: top - logoHeight, width: logoSize.width, height: logoHeight });
    // The same mark on the right keeps the centred title balanced.
    page.drawImage(this.logo, {
      x: PAGE.width - MARGIN - logoSize.width,
      y: top - logoHeight,
      width: logoSize.width,
      height: logoHeight,
      opacity: 0.12,
    });

    writeCentered(page, site.college.name.toUpperCase(), top - 16, this.style(16.5, true));
    writeCentered(page, `${site.college.status} · Salem, Tamil Nadu`, top - 29, this.style(8.5, false, COLOR.muted));
    writeCentered(page, 'Department of Artificial Intelligence & Data Science', top - 46, this.style(11.5, true, COLOR.violet));
    writeCentered(page, `${site.name} ${site.year}`, top - 72, this.style(25, true));
    writeCentered(
      page,
      `PARTICIPANT PASS  ·  ONE-DAY SYMPOSIUM  ·  ${(site.dates ?? '').toUpperCase()}`,
      top - 87,
      this.style(8.5, true, COLOR.muted),
    );

    page.drawLine({ start: { x: MARGIN, y: top - 97 }, end: { x: PAGE.width - MARGIN, y: top - 97 }, thickness: 2.2, color: COLOR.violet });
    page.drawLine({ start: { x: MARGIN, y: top - 100.5 }, end: { x: PAGE.width - MARGIN, y: top - 100.5 }, thickness: 0.6, color: COLOR.line });
    this.y = top - 114;
  }

  private continuationHeader() {
    const { page } = this;
    const top = this.y;
    const size = this.logo.scale(30 / this.logo.height);
    page.drawImage(this.logo, { x: MARGIN, y: top - 30, width: size.width, height: 30 });
    write(page, `${site.name} ${site.year} · Participant Pass`, MARGIN + size.width + 10, top - 13, this.style(11, true));
    write(page, `${site.college.name} · Department of Artificial Intelligence & Data Science`, MARGIN + size.width + 10, top - 26, this.style(8, false, COLOR.muted));
    writeRight(page, this.data.registrationId, PAGE.width - MARGIN, top - 13, this.style(11, true, COLOR.violet));
    page.drawLine({ start: { x: MARGIN, y: top - 38 }, end: { x: PAGE.width - MARGIN, y: top - 38 }, thickness: 1.2, color: COLOR.violet });
    this.y = top - 52;
  }

  /** Registration ID and amount paid, side by side. */
  summaryStrip() {
    const height = 56;
    const bottom = this.y - height;
    const { page } = this;
    roundedBox(page, MARGIN, bottom, CONTENT, height, 8, { fill: COLOR.violetSoft, border: COLOR.line });

    const idWidth = 196;
    roundedBox(page, MARGIN, bottom, idWidth, height, 8, { fill: COLOR.violet });
    write(page, 'REGISTRATION ID', MARGIN + 16, bottom + 36, this.style(7.5, true, rgb(0.85, 0.83, 1)));
    write(page, this.data.registrationId, MARGIN + 16, bottom + 13, this.style(21, true, COLOR.white));

    const paidX = MARGIN + idWidth + 22;
    write(page, 'REGISTRATION AMOUNT PAID', paidX, bottom + 36, this.style(7.5, true, COLOR.muted));
    write(page, rupees(this.data.amountPaid), paidX, bottom + 13, this.style(20, true));

    this.y = bottom - 16;
  }

  sectionTitle(title: string, minFollowing = 40) {
    this.ensure(20 + minFollowing);
    write(this.page, title.toUpperCase(), MARGIN, this.y - 10, this.style(9.5, true, COLOR.violet));
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 16 },
      end: { x: PAGE.width - MARGIN, y: this.y - 16 },
      thickness: 0.6,
      color: COLOR.line,
    });
    this.y -= 23;
  }

  /** Label-and-value pairs, up to three to a row, sharing the width. */
  details(rows: [label: string, value: string][][]) {
    const gap = 18;
    for (const row of rows) {
      const width = (CONTENT - gap * (row.length - 1)) / row.length;
      const valueStyle = this.style(10.5);
      const wrapped = row.map(([, value]) => wrap(value, valueStyle, width));
      const height = 12 + Math.max(...wrapped.map((lines) => lines.length)) * 13 + 5;
      this.ensure(height);
      row.forEach(([label], column) => {
        const x = MARGIN + column * (width + gap);
        write(this.page, label.toUpperCase(), x, this.y - 7, this.style(7, true, COLOR.muted));
        wrapped[column].forEach((line, index) => write(this.page, line, x, this.y - 19 - index * 13, valueStyle));
      });
      this.y -= height;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 3 },
        end: { x: PAGE.width - MARGIN, y: this.y + 3 },
        thickness: 0.4,
        color: COLOR.line,
      });
      this.y -= 4;
    }
    this.y -= 8;
  }

  /** The selected events as a short table, each with its fee. */
  eventTable() {
    const columns = [
      { title: '#', x: MARGIN + 10 },
      { title: 'Event', x: MARGIN + 34 },
      { title: 'Category', x: MARGIN + 300 },
    ];
    const feeRight = PAGE.width - MARGIN - 10;
    const rowHeight = 19;
    this.ensure(rowHeight * 2);
    roundedBox(this.page, MARGIN, this.y - rowHeight, CONTENT, rowHeight, 4, { fill: COLOR.violetSoft });
    for (const column of columns) write(this.page, column.title.toUpperCase(), column.x, this.y - 13, this.style(7.5, true, COLOR.muted));
    writeRight(this.page, 'FEE (PAY AT VENUE)', feeRight, this.y - 13, this.style(7.5, true, COLOR.muted));
    this.y -= rowHeight;

    this.data.events.forEach((event, index) => {
      this.ensure(rowHeight);
      const baseline = this.y - 13;
      write(this.page, String(index + 1), columns[0].x, baseline, this.style(9.5, false, COLOR.muted));
      write(this.page, event.name, columns[1].x, baseline, this.style(10, true));
      if (event.subtitle) {
        write(this.page, `  ${event.subtitle}`, columns[1].x + measure(event.name, this.style(10, true)), baseline, this.style(8.5, false, COLOR.muted));
      }
      write(this.page, CATEGORY_LABEL[event.category], columns[2].x, baseline, this.style(9.5, false, event.category === 'technical' ? COLOR.violet : COLOR.pink));
      writeRight(this.page, rupees(this.data.feePerEvent), feeRight, baseline, this.style(10, true));
      this.y -= rowHeight;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE.width - MARGIN, y: this.y }, thickness: 0.4, color: COLOR.line });
    });
    this.y -= 16;
  }

  paymentSummary() {
    const { amountPaid, feePerEvent, payableAtVenue, events } = this.data;
    const count = events.length;
    const rows: [label: string, value: string][] = [
      ['Registration Amount Paid (gate pass)', rupees(amountPaid)],
      ['Additional Event Fee', `${rupees(feePerEvent)} per selected event`],
      ['Number of Selected Events', String(count)],
      ['Event Fee Calculation', `${count} × ${rupees(feePerEvent)} = ${rupees(payableAtVenue)}`],
    ];
    const rowHeight = 16.5;
    const totalHeight = 28;
    this.ensure(rows.length * rowHeight + totalHeight + 8);

    const right = PAGE.width - MARGIN - 12;
    rows.forEach(([label, value], index) => {
      const baseline = this.y - 12.5;
      write(this.page, label, MARGIN + 12, baseline, this.style(10, false, COLOR.muted));
      writeRight(this.page, value, right, baseline, this.style(10, true));
      if (index === 0) {
        const tag = this.style(7, true, COLOR.green);
        const tagText = 'RECEIVED';
        const tagWidth = measure(tagText, tag) + 12;
        const tagRight = right - measure(value, this.style(10, true)) - 10;
        roundedBox(this.page, tagRight - tagWidth, baseline - 3.5, tagWidth, 13, 6.5, { fill: COLOR.greenSoft });
        write(this.page, tagText, tagRight - tagWidth + 6, baseline, tag);
      }
      this.y -= rowHeight;
    });

    this.y -= 4;
    roundedBox(this.page, MARGIN, this.y - totalHeight, CONTENT, totalHeight, 6, { fill: COLOR.ink });
    write(this.page, 'AMOUNT PAYABLE AT VENUE', MARGIN + 12, this.y - 18, this.style(10.5, true, COLOR.white));
    write(this.page, '(on the spot, during the symposium)', MARGIN + 12 + measure('AMOUNT PAYABLE AT VENUE', this.style(10.5, true)) + 8, this.y - 18, this.style(8.5, false, rgb(0.78, 0.8, 0.92)));
    writeRight(this.page, rupees(payableAtVenue), right, this.y - 19, this.style(15, true, COLOR.white));
    this.y -= totalHeight + 14;
  }

  notice() {
    const paragraphs = [
      `The registration amount of ${rupees(this.data.amountPaid)} has been received.`,
      `Each selected event requires an additional participation fee of ${rupees(this.data.feePerEvent)} per event.`,
      'The additional event participation fee must be paid separately ON THE SPOT during the symposium.',
      `The ${rupees(this.data.amountPaid)} registration amount does NOT include the individual event participation fees.`,
    ];
    const textStyle = this.style(9.5);
    const innerWidth = CONTENT - 40;
    const lines = paragraphs.map((paragraph) => wrap(paragraph, textStyle, innerWidth));
    const height = 34 + lines.reduce((sum, paragraphLines) => sum + paragraphLines.length * 12.5 + 3, 0) + 4;
    this.ensure(height);

    const bottom = this.y - height;
    roundedBox(this.page, MARGIN, bottom, CONTENT, height, 8, { fill: COLOR.amberSoft, border: COLOR.amberLine, borderWidth: 1.2 });
    this.page.drawRectangle({ x: MARGIN + 0.6, y: bottom + 8, width: 4, height: height - 16, color: COLOR.amberLine });

    const titleY = this.y - 21;
    this.page.drawCircle({ x: MARGIN + 23, y: titleY + 3.5, size: 7.5, color: COLOR.amber });
    write(this.page, '!', MARGIN + 21.3, titleY, this.style(10, true, COLOR.white));
    write(this.page, 'IMPORTANT NOTICE', MARGIN + 36, titleY, this.style(11.5, true, COLOR.amber));

    let baseline = titleY - 18;
    for (const paragraphLines of lines) {
      this.page.drawCircle({ x: MARGIN + 24, y: baseline + 3.2, size: 1.6, color: COLOR.amber });
      for (const line of paragraphLines) {
        write(this.page, line, MARGIN + 32, baseline, textStyle);
        baseline -= 12.5;
      }
      baseline -= 3;
    }
    this.y = bottom - 18;
  }

  /** One card per selected event: what it is, where and when. */
  eventDetails() {
    const innerX = MARGIN + 16;
    const innerWidth = CONTENT - 28;
    for (const event of this.data.events) {
      const descriptionStyle = this.style(9.5);
      const description = wrap(event.description, descriptionStyle, innerWidth);
      const kind = event.type?.split('·')[1]?.trim();
      const team = event.team && !kind?.toLowerCase().includes(event.team.toLowerCase()) ? event.team : undefined;
      const meta = [CATEGORY_LABEL[event.category], kind, team].filter(Boolean).join('  ·  ');
      const facts: [label: string, value: string, share: number][] = [
        ['Venue', event.venue, 0.5],
        ['Date', event.date, 0.25],
        ['Timing', event.timing, 0.25],
      ];
      const factLines = facts.map(([, value, share]) => wrap(value, this.style(8.5, true), innerWidth * share - 10));
      const factHeight = 12 + Math.max(...factLines.map((lines) => lines.length)) * 10.5;
      const height = 22 + 14 + description.length * 12.5 + 8 + factHeight;
      this.ensure(height + 10);

      const bottom = this.y - height;
      const accent = event.category === 'technical' ? COLOR.violet : COLOR.pink;
      roundedBox(this.page, MARGIN, bottom, CONTENT, height, 7, { border: COLOR.line });
      this.page.drawRectangle({ x: MARGIN + 0.5, y: bottom + 7, width: 3.5, height: height - 14, color: accent });

      let baseline = this.y - 18;
      write(this.page, event.name, innerX, baseline, this.style(12, true));
      if (event.subtitle) write(this.page, `—  ${event.subtitle}`, innerX + measure(event.name, this.style(12, true)) + 8, baseline, this.style(9.5, false, COLOR.muted));
      baseline -= 14;
      write(this.page, meta, innerX, baseline, this.style(8.5, true, accent));
      baseline -= 14;
      for (const line of description) {
        write(this.page, line, innerX, baseline, descriptionStyle);
        baseline -= 12.5;
      }

      baseline -= 6;
      let x = innerX;
      facts.forEach(([label, , share], index) => {
        write(this.page, label.toUpperCase(), x, baseline + 2, this.style(6.5, true, COLOR.muted));
        factLines[index].forEach((line, lineIndex) => write(this.page, line, x, baseline - 9 - lineIndex * 10.5, this.style(8.5, true)));
        x += innerWidth * share;
      });
      this.y = bottom - 10;
    }
    this.y -= 6;
  }

  /** Footer and page numbers, once every page exists. */
  footers() {
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const lineY = MARGIN + 34;
      page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: PAGE.width - MARGIN, y: lineY }, thickness: 0.6, color: COLOR.line });
      write(
        page,
        'Present this pass (printed or on your phone) with your college ID card at the registration desk.',
        MARGIN,
        lineY - 13,
        this.style(8, true),
      );
      write(
        page,
        `${site.college.name}, Salem  ·  ${site.college.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}  ·  Registered on ${formatIstDateTime(this.data.registeredAt)}`,
        MARGIN,
        lineY - 25,
        this.style(7.5, false, COLOR.muted),
      );
      writeRight(page, `Page ${index + 1} of ${total}`, PAGE.width - MARGIN, lineY - 13, this.style(7.5, false, COLOR.muted));
    });
  }
}

/** Builds the participant pass PDF. `logoJpeg` is the RPSIT crest (public/images/rpsit-logo-pass.jpg). */
export async function buildPassPdf(data: PassData, logoJpeg: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${site.name} ${site.year} Participant Pass - ${data.registrationId}`);
  pdf.setAuthor(`${site.college.name} - Department of Artificial Intelligence & Data Science`);
  pdf.setSubject(`${site.name} ${site.year} participant pass for ${data.participant.name}`);
  pdf.setCreator(`${site.name} ${site.year} registration`);
  pdf.setProducer(`${site.name} ${site.year}`);

  const layout = new PassLayout(
    pdf,
    { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) },
    await pdf.embedJpg(logoJpeg),
    data,
  );
  const { participant } = data;

  layout.addPage();
  layout.summaryStrip();

  layout.sectionTitle('Participant Details');
  layout.details([
    [['Name', participant.name], ['Registration ID', data.registrationId], ['Year of Study', participant.year]],
    [['Email', participant.email], ['Phone', participant.phone], ['Transaction ID (UPI / UTR)', data.transactionId]],
    [['College', participant.college], ['Department', participant.department]],
  ]);

  layout.sectionTitle(`Selected Events (${data.events.length})`);
  layout.eventTable();

  layout.sectionTitle('Payment Summary', 110);
  layout.paymentSummary();

  layout.notice();

  layout.sectionTitle('Event Details', 90);
  layout.eventDetails();

  layout.footers();
  return pdf.save();
}
