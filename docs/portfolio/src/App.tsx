import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Features from './components/Features';
import Highlights from './components/Highlights';
import QuickStart from './components/QuickStart';
import TechStack from './components/TechStack';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Navbar />
      <Hero />
      <Features />
      <Highlights />
      <QuickStart />
      <TechStack />
      <Footer />
    </div>
  );
}

export default App;
