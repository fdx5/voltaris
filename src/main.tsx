import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/sortie-menu.css';
import { installViewport } from './ui/viewport';
import { loadImportedFleet } from './visual/ImportedFleet';
import { loadNovaMissile } from './visual/NovaMissile';
import { loadPlayerLoadout } from './visual/PlayerLoadout';
import { getLocale, t } from './ui/i18n';
installViewport();
document.documentElement.lang = getLocale();
const host = document.getElementById('root')!;
const root = ReactDOM.createRoot(host);
function start() {
  root.render(
    <div role="status" style={{ color: '#c5d8e2', padding: '12vh 8vw', fontFamily: 'sans-serif' }}>
      {t('PREPARING_HANGAR')}
    </div>,
  );
  void Promise.all([loadImportedFleet(), loadNovaMissile(), loadPlayerLoadout()])
    .then(() => root.render(<App />))
    .catch(() => {
      root.render(
        <div
          role="alert"
          style={{ color: '#c5d8e2', padding: '12vh 8vw', fontFamily: 'sans-serif' }}
        >
          <p>{t('MODEL_LOAD_FAILED')}</p>
          <button onClick={start}>{t('TRY_AGAIN')}</button>
        </div>,
      );
    });
}
start();
