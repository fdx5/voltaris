import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { installViewport } from './ui/viewport';
import { loadBlenderFleet } from './visual/BlenderFleet';
installViewport();
const host = document.getElementById('root')!;
const root = ReactDOM.createRoot(host);
function start() {
  root.render(
    <div role="status" style={{ color: '#c5d8e2', padding: '12vh 8vw', fontFamily: 'sans-serif' }}>
      VOLTARIS · 기체 격납고를 준비하고 있습니다…
    </div>,
  );
  void loadBlenderFleet()
    .then(() => root.render(<App />))
    .catch(() => {
      root.render(
        <div
          role="alert"
          style={{ color: '#c5d8e2', padding: '12vh 8vw', fontFamily: 'sans-serif' }}
        >
          <p>기체 모델을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.</p>
          <button onClick={start}>다시 시도</button>
        </div>,
      );
    });
}
start();
