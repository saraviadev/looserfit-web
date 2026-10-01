import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App.jsx'
import { CartProvider } from './context/CartContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { getBrandSlug } from './services/api'

document.title = 'looserfit.com'

// El slug se detecta desde la URL al cargar la página
// /sport/* → 'sport'  |  /* → 'fit'
const initialBrandSlug = getBrandSlug()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CartProvider brandSlug={initialBrandSlug}>
          <App />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)