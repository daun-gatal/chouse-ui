import Navbar from './components/Navbar';
import Hero from './components/Hero';
import WhatsNew from './components/WhatsNew';
import Features from './components/Features';
import ClosedLoop from './components/ClosedLoop';
import TryLab from './components/TryLab';
import Highlights from './components/Highlights';
import QuickStart from './components/QuickStart';
import DockerDeploy from './components/DockerDeploy';
import FAQ from './components/FAQ';
import Changelog from './components/Changelog';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Navbar />
      <Hero />
      <WhatsNew />
      <Features />
      <ClosedLoop />
      <TryLab />
      <Highlights />
      <QuickStart />
      <DockerDeploy />
      <FAQ />
      <Changelog />
      <Footer />
    </div>
  );
}

export default App;
