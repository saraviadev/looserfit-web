/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useBrand } from '../../context/BrandContext';
import { getBrandConfig } from '../../config/siteConfig';
import './BrandLogoSwitcher.css';

export default function BrandLogoSwitcher() {
  const { brand } = useBrand();
  const location = useLocation();
  const [allowHover, setAllowHover] = useState(false);

  const currentSlug = brand?.slug || 'fit';
  const otherSlug = currentSlug === 'fit' ? 'sport' : 'fit';
  
  const currentConfig = getBrandConfig(currentSlug);
  const otherConfig = getBrandConfig(otherSlug);

  // Evitar el "hover fantasma": exigir que el usuario mueva el mouse una distancia real
  useEffect(() => {
    setAllowHover(false);
    
    let startX = null;
    let startY = null;

    const handleMouseMove = (e) => {
      if (startX === null || startY === null) {
        startX = e.clientX;
        startY = e.clientY;
        return; // Guardar coordenada inicial
      }

      // Calcular distancia recorrida
      const distance = Math.sqrt(
        Math.pow(e.clientX - startX, 2) + Math.pow(e.clientY - startY, 2)
      );

      // Si movió el mouse más de 25 píxeles reales, habilitar el hover
      if (distance > 25) {
        setAllowHover(true);
        window.removeEventListener('mousemove', handleMouseMove);
      }
    };

    // Ignorar vibraciones residuales del momento del click (200ms)
    const timer = setTimeout(() => {
      window.addEventListener('mousemove', handleMouseMove);
    }, 200);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [location.pathname]); // Resetear cada vez que cambia la ruta

  return (
    <div className={`brand-logo-switcher ${allowHover ? 'allow-hover' : ''}`}>
      
      {/* LOGO INACTIVO (Fondo / Sombra) - Oculto temporalmente */}
      <Link
        to={otherSlug === 'fit' ? '/' : '/sport'}
        aria-label={`Cambiar a ${otherConfig.name}`}
        className="brand-logo-back"
        style={{ display: 'none' }}
      >
        <img
          src={otherConfig.assets.logo}
          alt={otherConfig.name}
          className={`brand-img ${otherSlug === 'sport' ? 'brand-img--sport' : ''}`}
        />
      </Link>

      {/* LOGO ACTIVO (Frente) */}
      <Link
        to={currentSlug === 'fit' ? '/' : '/sport'}
        aria-label={`Ir al inicio de ${currentConfig.name}`}
        className="brand-logo-front"
      >
        <img
          src={currentConfig.assets.logo}
          alt={currentConfig.name}
          className={`brand-img ${currentSlug === 'sport' ? 'brand-img--sport' : ''}`}
        />
      </Link>
    </div>
  );
}
