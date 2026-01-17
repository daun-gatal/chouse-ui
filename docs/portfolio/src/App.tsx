import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import Highlights from './components/Highlights';
import QuickStart from './components/QuickStart';
import DockerDeploy from './components/DockerDeploy';
import TechStack from './components/TechStack';
import FAQ from './components/FAQ';
import Changelog from './components/Changelog';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Navbar />
      <Hero />
      <Features />
      <Highlights />
      <QuickStart />
      <DockerDeploy />
      <TechStack />
      <FAQ />
      <Changelog />
      <Footer />
    </div>
  );
}

export default App;
