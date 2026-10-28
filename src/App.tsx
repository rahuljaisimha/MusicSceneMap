import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { ExplorePage } from "./pages/ExplorePage";
import { PlayPage } from "./pages/PlayPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { SimilarityPage } from "./pages/SimilarityPage";
import { AboutPage } from "./pages/AboutPage";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/similarity" element={<SimilarityPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
