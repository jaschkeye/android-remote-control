import { HashRouter, Routes, Route } from 'react-router-dom';
import ScreenMirror from './pages/ScreenMirror';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<ScreenMirror />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
