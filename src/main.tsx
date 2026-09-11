import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { installViewport } from './ui/viewport';
installViewport();
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
