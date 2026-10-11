import { site } from '../../content/site';
import { STUDENT_PAGE } from '../../lib/student';
import { telHref, whatsappHref } from './HelpDeskLine';
import './HelpDesk.css';

/** What students ask most, answered before they call. */
const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Where do I get my participant pass?',
    a: 'Passes are not emailed. Once your registration is approved, open Student login on this website and sign in with your Registration ID and phone number to download it.',
  },
  {
    q: 'I paid, but my registration still says pending.',
    a: 'The organisers check every GPay payment by hand. On the event day, go to the registration desk with your payment screenshot: they can verify it at once.',
  },
  {
    q: 'I paid at the desk or a venue by GPay. Do I need to do anything?',
    a: 'Please upload the payment screenshot on the student page (Student login). It helps the organisers match your payment.',
  },
  {
    q: 'How do I find my venue?',
    a: 'Every event has a Route map button. Delta Lab and Theta Lab are on the second floor of the main building; volunteers at the gate will guide you too.',
  },
  {
    q: 'I forgot my Registration ID.',
    a: 'Call the help desk or ask at the registration desk with your phone number: they will find it.',
  },
];

/** The help desk: who to call for any help, where it is on the day, and quick answers. */
export function HelpDeskSection() {
  const { phones, where, hours } = site.helpDesk;
  return (
    <section id="help" className="section help-desk" aria-labelledby="help-title">
      <div className="container help-desk__inner">
        <div className="help-desk__card" data-reveal>
          <p className="help-desk__eyebrow">Help desk</p>
          <h2 id="help-title" className="section-title help-desk__title">
            Need help? Call us
          </h2>
          <p className="help-desk__lead">For any help with registration, payments, your pass or finding a venue, call or WhatsApp the help desk.</p>
          <div className="help-desk__phones">
            {phones.map((line) => (
              <div key={line.phone} className="help-desk__phone">
                <span className="help-desk__label">{line.label}</span>
                <a className="help-desk__number" href={telHref(line.phone)}>
                  {line.phone}
                </a>
                <span className="help-desk__actions">
                  <a className="help-desk__button" href={telHref(line.phone)}>
                    Call
                  </a>
                  <a className="help-desk__button help-desk__button--wa" href={whatsappHref(line.phone)} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                </span>
              </div>
            ))}
          </div>
          <dl className="help-desk__facts">
            <div>
              <dt>Where</dt>
              <dd>{where}</dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>{hours}</dd>
            </div>
          </dl>
          <a className="help-desk__student" href={STUDENT_PAGE}>
            Student login: your pass, your events and their timings →
          </a>
        </div>

        <div className="help-desk__faq" data-reveal>
          <h3 className="help-desk__faq-title">Quick answers</h3>
          {QUESTIONS.map((item) => (
            <details key={item.q} className="help-desk__q">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
