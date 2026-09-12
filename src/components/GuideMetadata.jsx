import { useI18n } from '../i18n.jsx';
import { formatGuideUpdatedDate, guideAuthorName } from '../guide-metadata.js';

export default function GuideMetadata({ guide }) {
  const { language, t } = useI18n();
  const updated = formatGuideUpdatedDate(guide?.pageUpdatedAt, language);
  const author = guideAuthorName(guide?.author);
  return (
    <dl className="guide-public-metadata">
      <div><dt>{t('guide.author')}</dt><dd>{author || t('guide.unknownAuthor')}</dd></div>
      <div><dt>{t('guide.updated')}</dt><dd>{updated
        ? <time dateTime={updated.iso}>{updated.label}</time>
        : t('guide.unknownDate')}</dd></div>
    </dl>
  );
}
