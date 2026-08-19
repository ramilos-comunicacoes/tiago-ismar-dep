document.addEventListener('DOMContentLoaded', () => {
  // 1. Preloader & Initialization
  const preloader = document.getElementById('preloader');
  
  // 6. Prevent Scroll setup
  const preventScroll = (e) => {
    e.preventDefault();
  };
  const preventScrollKeys = (e) => {
    const keys = [32, 33, 34, 35, 36, 37, 38, 39, 40]; // space, page up/down, end, home, arrows
    if (keys.includes(e.keyCode)) {
      e.preventDefault();
    }
  };
  
  // Enable prevent scroll initially
  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });
  window.addEventListener('keydown', preventScrollKeys, { passive: false });

  // Initialize page animations and particles immediately
  initAnimations();
  initParticles();

  // 2. Staggered Entrance Animations & 5. Name Typewriter Effect
  function initAnimations() {
    const animItems = document.querySelectorAll('.anim-item');
    const nameText = document.getElementById('nameText');
    let nameToType = 'TIAGO ISMAR';
    
    if (nameText) {
      nameToType = nameText.textContent.trim() || 'TIAGO ISMAR';
      nameText.textContent = '';
    }

    animItems.forEach(item => {
      const delayVal = parseInt(item.getAttribute('data-delay') || '0', 10);
      const delay = 100 + (delayVal * 150);
      
      setTimeout(() => {
        item.classList.add('visible');
        
        // Trigger typewriter when name text container becomes visible
        if (item.contains(nameText) || item === nameText) {
          typeWriter(nameText, nameToType, 0);
        }
      }, delay);
    });
  }

  // Typewriter Function
  function typeWriter(element, text, index) {
    if (!element) return;
    
    if (index < text.length) {
      element.textContent += text.charAt(index);
      setTimeout(() => {
        typeWriter(element, text, index + 1);
      }, 80);
    } else {
      element.classList.add('cursor-blink');
      setTimeout(() => {
        element.classList.remove('cursor-blink');
      }, 2000);
    }
  }

  // 3. Particle System
  function initParticles() {
    const canvas = document.getElementById('particles');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    let particlesArray = [];
    
    // Set canvas dimensions
    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2 + 0.5; // 0.5 to 2.5
        this.speedY = Math.random() * -0.25 - 0.15; // -0.15 to -0.4
        this.speedX = Math.random() * 0.2 - 0.1; // -0.1 to 0.1
        this.opacity = Math.random() * 0.2 + 0.05; // 0.05 to 0.25
        this.color = Math.random() > 0.3 ? '#D4A843' : '#1B8C3A'; // 70% gold, 30% green
      }
      
      update() {
        this.y += this.speedY;
        this.x += this.speedX;
        
        // Reset if it goes off top
        if (this.y < -10) {
          this.y = canvas.height + 10;
          this.x = Math.random() * canvas.width;
        }
        
        // Wrap horizontally
        if (this.x > canvas.width + 10) this.x = -10;
        if (this.x < -10) this.x = canvas.width + 10;
      }
      
      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        
        // Convert hex to rgb for rgba
        let r, g, b;
        if (this.color === '#D4A843') { // Gold
          r = 212; g = 168; b = 67;
        } else { // Green
          r = 27; g = 140; b = 58;
        }
        
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${this.opacity})`;
        ctx.fill();
      }
    }
    
    function createParticles() {
      particlesArray = [];
      const numParticles = window.innerWidth >= 768 ? 35 : 20;
      for (let i = 0; i < numParticles; i++) {
        particlesArray.push(new Particle());
      }
    }
    
    createParticles();
    
    // Recreate particles occasionally on resize to adjust amount
    window.addEventListener('resize', () => {
      // Debounce slightly
      clearTimeout(window.resizeParticleTimeout);
      window.resizeParticleTimeout = setTimeout(createParticles, 200);
    });
    
    function animateParticles() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
      }
      requestAnimationFrame(animateParticles);
    }
    
    animateParticles();
  }

  // 4. Image Placeholder Handling
  const logoImg = document.querySelector('.logo');
  const logoPlaceholder = document.querySelector('.logo-placeholder');
  
  if (logoImg) {
    logoImg.addEventListener('error', () => {
      logoImg.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';
    });
  }

  const profileImg = document.querySelector('.photo-inner img');
  const profilePlaceholder = document.querySelector('.photo-placeholder');
  
  if (profileImg) {
    profileImg.addEventListener('error', () => {
      profileImg.style.display = 'none';
      if (profilePlaceholder) profilePlaceholder.style.display = 'flex';
    });
  }

  // Handle all background images (desktop + mobile)
  const bgImages = document.querySelectorAll('.bg-image');
  bgImages.forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
  });
});
