import { HashRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ExplorePage } from "./pages/ExplorePage";
import { PlayPage } from "./pages/PlayPage";
import { DiscoverPage } from "./pages/DiscoverPage";
import { AboutPage } from "./pages/AboutPage";

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ExplorePage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
