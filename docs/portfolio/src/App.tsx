import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import ClosedLoop from './components/ClosedLoop';
import TryLab from './components/TryLab';
import QuickStart from './components/QuickStart';
import Automate from './components/Automate';
import DockerDeploy from './components/DockerDeploy';
import Sso from './components/Sso';
import FAQ from './components/FAQ';
import Changelog from './components/Changelog';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Navbar />
      <Hero />
      <ClosedLoop />
      <Features />
      <TryLab />
      <QuickStart />
      <Automate />
      <DockerDeploy />
      <Sso />
      <FAQ />
      <Changelog />
      <Footer />
    </div>
  );
}

export default App;
