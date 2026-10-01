import { useI18n } from '../i18n';
import { formatDuration, formatSize, formatBitrate } from '../lib/format';

// Renders the unified media summary:
//   MP4 · ~16.5 GB · 01:39:47 · H.264 (GPU) · 3840×2160 · 24 FPS · 22118 kbps
function SummaryRow({ label, children }) {
  return (
    <div className="summary-row">
      <span className="summary-label">{label}</span>
      <span className="summary-value">{children}</span>
    </div>
  );
}

function sizeDisplay(sizeEstimate, sizeNoteKey, t) {
  if (sizeEstimate === 'source') return t('plan.sizeSource');
  if (typeof sizeEstimate === 'number' && sizeEstimate > 0) return `~${formatSize(sizeEstimate)}`;
  return t(sizeNoteKey || 'plan.sizeCRF');
}

export function PlanSummary({ plan, source }) {
  const { t } = useI18n();
  if (!plan) return null;
  return (
    <div className="card summary-card">
      <div className="summary-head">{t('plan.title')}</div>
      <div className="summary-cols">
        <div className="summary-col">
          <div className="summary-col-title">{t('plan.source')}</div>
          {source && source.durationSec > 0 && (
            <SummaryRow label={t('common.duration')}>{formatDuration(source.durationSec)}</SummaryRow>
          )}
          {source && source.size > 0 && (
            <SummaryRow label={t('common.size')}>{formatSize(source.size)}</SummaryRow>
          )}
          {source?.video && (
            <SummaryRow label={t('common.resolution')}>{source.video.width}×{source.video.height}</SummaryRow>
          )}
          {source?.video?.codec && (
            <SummaryRow label={t('common.codec')}>{source.video.codec.toUpperCase()}</SummaryRow>
          )}
        </div>
        <div className="summary-arrow" aria-hidden="true">→</div>
        <div className="summary-col output">
          <div className="summary-col-title">{t('plan.output')}</div>
          {plan.containerLabel && (
            <SummaryRow label={t('param.container')}>{plan.containerLabel}</SummaryRow>
          )}
          <SummaryRow label={t('common.size')}>
            <span className="summary-size">{sizeDisplay(plan.sizeEstimate, plan.sizeNoteKey, t)}</span>
          </SummaryRow>
          {plan.durationSec > 0 && (
            <SummaryRow label={t('common.duration')}>{formatDuration(plan.durationSec)}</SummaryRow>
          )}
          {plan.videoEncoderLabel && (
            <SummaryRow label={t('common.codec')}>{plan.videoEncoderLabel}</SummaryRow>
          )}
          {plan.cpuNote && !plan.hw && (
            <SummaryRow label={t('param.hwStrategy')}>
              <span className="summary-cpu">{t('plan.cpuNote')}</span>
            </SummaryRow>
          )}
          {plan.width && plan.height && (
            <SummaryRow label={t('common.resolution')}>{plan.width}×{plan.height}</SummaryRow>
          )}
          {plan.fps ? (
            <SummaryRow label={t('common.fps')}>{plan.fps} FPS</SummaryRow>
          ) : null}
          {plan.qualityLabel && (
            <SummaryRow label={t('plan.quality')}>{plan.qualityLabel}</SummaryRow>
          )}
          {plan.audioEncoderLabel && (
            <SummaryRow label={t('nav.audio')}>
              {plan.audioEncoderLabel}{plan.audioCopy ? ` · ${t('plan.audioCopy')}` : ''}
            </SummaryRow>
          )}
        </div>
      </div>
    </div>
  );
}

export function ActualSummary({ actual }) {
  const { t } = useI18n();
  if (!actual) return null;
  return (
    <div className="actual-line">
      <span className="actual-label">{t('plan.actual')}:</span>
      <span className="actual-values">
        {[
          actual.containerLabel,
          actual.size ? formatSize(actual.size) : null,
          actual.durationSec > 0 ? formatDuration(actual.durationSec) : null,
          actual.videoEncoderLabel,
          actual.width ? `${actual.width}×${actual.height}` : null,
          actual.bitrate > 0 ? formatBitrate(actual.bitrate) : null
        ].filter(Boolean).join(' · ')}
      </span>
    </div>
  );
}
