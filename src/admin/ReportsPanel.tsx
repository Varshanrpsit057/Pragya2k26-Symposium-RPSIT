/**
 * Admin reports: registrations, gate passes, event fees and attendance, who collected what,
 * and the Excel report with all of it (src/admin/workbooks.ts).
 */
import { useCallback, useState } from 'react';
import { rupees } from '../lib/registration';
import type { SessionInfo } from '../lib/staff';
import { XLSX_TYPE } from '../lib/xlsx';
import { SignedOut, getReport, listRegistrations, systemStatus } from './adminApi';
import { ErrorNote, LiveStatus, saveFile, useLiveData } from './ui';
import { allDataWorkbook, reportWorkbook } from './workbooks';

interface PanelProps {
  token: string;
  session: SessionInfo;
  onSignedOut: () => void;
}

export function ReportsPanel({ token, session, onSignedOut }: PanelProps) {
  const load = useCallback(() => getReport(token), [token]);
  const live = useLiveData(load, onSignedOut, 30_000);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'report' | 'all' | null>(null);
  const report = live.data;

  /** Every registration with every payment and attendance, and the deleted records. */
  const downloadAll = async () => {
    setBusy('all');
    setError(null);
    try {
      const [registrations, status] = await Promise.all([listRegistrations(token), systemStatus(token)]);
      const file = allDataWorkbook({ registrations, deleted: status.deleted, generatedBy: session.displayName, now: Date.now() });
      saveFile(file.name, file.bytes, XLSX_TYPE);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };

  const downloadReport = async () => {
    setBusy('report');
    setError(null);
    try {
      // Fresh figures for the file, whatever the screen shows.
      const [latest, registrations] = await Promise.all([getReport(token), listRegistrations(token)]);
      const file = reportWorkbook({ report: latest, registrations, generatedBy: session.displayName, now: Date.now() });
      saveFile(file.name, file.bytes, XLSX_TYPE);
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };

  const cash = report ? report.gatePass.deskCash.amount + report.events.reduce((sum, event) => sum + event.cashAmount, 0) : 0;
  const upi = report ? report.gatePass.onlineVerified.amount + report.gatePass.deskUpi.amount + report.events.reduce((sum, event) => sum + event.upiAmount, 0) : 0;

  return (
    <main className="adm-page">
      <section className="adm-card adm-pad">
        <div className="adm-toolbar">
          <h2 className="adm-h2">Reports</h2>
          <button className="adm-button adm-button--primary" type="button" disabled={busy !== null} onClick={() => void downloadReport()}>
            {busy === 'report' ? 'Preparing…' : 'Download report (Excel)'}
          </button>
          <button className="adm-button" type="button" disabled={busy !== null} onClick={() => void downloadAll()}>
            {busy === 'all' ? 'Preparing…' : 'Download all data (Excel)'}
          </button>
          <LiveStatus updatedAt={live.updatedAt} loading={live.loading} onRefresh={live.refresh} />
        </div>
        <ErrorNote error={live.error ?? error} />
        {report && (
          <div className="adm-report">
            <div className="adm-stats">
              <Stat label="Registrations" value={report.registrations.total} note={`${report.registrations.online} online · ${report.registrations.onsite} on-site`} />
              <Stat label="Approved" value={report.registrations.approved} note={`${report.registrations.pending} pending · ${report.registrations.rejected} rejected · ${report.registrations.cancelled} cancelled`} />
              <Stat label="Gate passes online" value={rupees(report.gatePass.onlineVerified.amount)} note={`${report.gatePass.onlineVerified.count} verified`} />
              <Stat label="Gate passes at desk" value={rupees(report.gatePass.deskCash.amount + report.gatePass.deskUpi.amount)} note={`${report.gatePass.deskCash.count} cash · ${report.gatePass.deskUpi.count} GPay`} />
              <Stat label="Total in cash" value={rupees(cash)} note="Desk gate passes and event fees" />
              <Stat label="Total by GPay / UPI" value={rupees(upi)} note="Online, desk and event fees" />
            </div>
            <p className="adm-muted">
              The Excel report has these figures with the time it was made, every registered student and each event's participants. All data has every
              registration, every payment with its transaction IDs, attendance and the deleted records.
            </p>

            <h3 className="adm-h3">Registration desks</h3>
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--static">
                <thead>
                  <tr>
                    <th scope="col">Desk</th>
                    <th scope="col">Students registered</th>
                    <th scope="col">Cash gate passes</th>
                    <th scope="col">GPay gate passes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.desks.map((row) => (
                    <tr key={row.desk}>
                      <td>Desk {row.desk}</td>
                      <td>{row.registrations}</td>
                      <td>
                        {row.cashCount} · {rupees(row.cash)}
                      </td>
                      <td>
                        {row.upiCount} · {rupees(row.upi)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.desks.length === 0 && <p className="adm-muted">No desk registrations yet.</p>}
            </div>

            <h3 className="adm-h3">Events</h3>
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--static">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Registered</th>
                    <th scope="col">Fees paid</th>
                    <th scope="col">Cash / GPay</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Present</th>
                    <th scope="col">Results</th>
                  </tr>
                </thead>
                <tbody>
                  {report.events.map((event) => (
                    <tr key={event.eventId}>
                      <td>{event.name}</td>
                      <td>{event.enrolled}</td>
                      <td>{event.feesPaid}</td>
                      <td>
                        {event.cash} / {event.upi}
                      </td>
                      <td>{rupees(event.amount)}</td>
                      <td>{event.present}</td>
                      <td>{event.resultStatus === 'SUBMITTED' ? 'Final' : event.resultStatus === 'REOPENED' ? 'Being corrected' : 'Not submitted'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="adm-h3">Money recorded by each student coordinator</h3>
            <p className="adm-muted">Gate passes at the desk and event fees, as recorded. Reconcile the cash with each person and the GPay payments with the account statement.</p>
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--static">
                <thead>
                  <tr>
                    <th scope="col">Student coordinator</th>
                    <th scope="col">Payments</th>
                    <th scope="col">Cash</th>
                    <th scope="col">GPay / UPI</th>
                  </tr>
                </thead>
                <tbody>
                  {report.collectedBy.map((row) => (
                    <tr key={row.username}>
                      <td className="adm-mono">{row.username}</td>
                      <td>{row.count}</td>
                      <td>{rupees(row.cash)}</td>
                      <td>{rupees(row.upi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.collectedBy.length === 0 && <p className="adm-muted">No money recorded at the venue yet.</p>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <div className="adm-stat">
      <span className="adm-stat__label">{label}</span>
      <strong className="adm-stat__value">{value}</strong>
      <span className="adm-muted">{note}</span>
    </div>
  );
}
