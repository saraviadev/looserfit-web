import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BASE_URL, getAuthHeaders, getCategories, getProductoById } from '../../services/api'
import { SIZES_BY_CATEGORY } from '../../constants/productConstants'
import './Admin.css'

export default function AdminNuevoProducto() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const esEdicion = Boolean(id)

  const [form, setForm] = useState({
    nombre:      '',
    descripcion: '',
    precio:      '',
    precioOferta:'',
    categoria:   '',
    tipo:        'regular',
    publicado:   false,
    esNuevoDrop: false,
    stock:       0,
    talles:      [],
    guiaTalles:  '',
  })

  const [realCategories, setRealCategories] = useState([])
  const [imagenes,    setImagenes]    = useState([])   // archivos nuevos
  const [previews,    setPreviews]    = useState([])   // URLs preview
  const [imgExistentes, setImgExistentes] = useState([]) // URLs ya en DB
  const [guiaTallesImg, setGuiaTallesImg] = useState(null) // Nuevo archivo guía
  const [guiaTallesPreview, setGuiaTallesPreview] = useState('') // Preview guía
  const [loading,     setLoading]     = useState(false)
  const [loadingData, setLoadingData] = useState(esEdicion)
  const [error,       setError]       = useState('')
  const [exito,       setExito]       = useState(false)

  // Cargar categorías reales del backend
  useEffect(() => {
    getCategories()
      .then(data => {
        setRealCategories(data)
        if (!esEdicion && data.length > 0 && !form.categoria) {
          setForm(p => ({ ...p, categoria: data[0]._id }))
        }
      })
      .catch(err => console.error('Error al cargar categorías:', err))
  }, [esEdicion, form.categoria])

  // Obtener nombre de la categoría activa para los talles
  const activeCatObj = realCategories.find(c => c._id === form.categoria)
  // Si es edición, cargar datos existentes
  useEffect(() => {
    if (!esEdicion) return
    getProductoById(id)
      .then(data => {
        setForm({
          nombre:      data.nombre      || '',
          descripcion: data.descripcion || '',
          precio:      data.precio      || '',
          precioOferta:data.precioOferta|| '',
          categoria:   data.categoria?._id || data.categoria || '',
          tipo:        data.tipo        || 'regular',
          publicado:   data.publicado   || false,
          esNuevoDrop: data.esNuevoDrop || false,
          stock:       data.stock       || 0,
          talles:      data.talles      || [],
          guiaTalles:  data.guiaTalles  || '',
        })
        setImgExistentes(data.imagenes || [])
        setLoadingData(false)
      })
      .catch(() => setLoadingData(false))
  }, [esEdicion, id])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(prev => {
      const newVal = type === 'checkbox' ? checked : value
      
      // Si cambia la categoría, limpiamos los talles para evitar mezclar formatos
      if (name === 'categoria' && newVal !== prev.categoria) {
        return {
          ...prev,
          [name]: newVal,
          talles: []
        }
      }

      return {
        ...prev,
        [name]: newVal
      }
    })
  }

  const handleTalle = (t) => {
    setForm(prev => ({
      ...prev,
      talles: prev.talles.includes(t)
        ? prev.talles.filter(x => x !== t)
        : [...prev.talles, t]
    }))
  }

  const compressImage = (file, maxWidth = 1000, quality = 0.7) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = (maxWidth / width) * height;
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            // Guardamos el blob y adjuntamos el nombre original para usarlo en FormData
            blob.name = file.name;
            resolve(blob);
          }, 'image/jpeg', quality);
        };
      };
    });
  };

  const handleImagenes = async (e) => {
    const files = Array.from(e.target.files)
    setLoading(true)
    const compressedFiles = await Promise.all(files.map(f => compressImage(f)))
    setImagenes(prev => [...prev, ...compressedFiles])
    const urls = compressedFiles.map(f => URL.createObjectURL(f))
    setPreviews(prev => [...prev, ...urls])
    setLoading(false)
  }

  const handleGuiaTallesImg = async (e) => {
    const file = e.target.files[0]
    if (file) {
      setLoading(true)
      const compressed = await compressImage(file)
      setGuiaTallesImg(compressed)
      setGuiaTallesPreview(URL.createObjectURL(compressed))
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {

      if (!form.categoria) {
        throw new Error('La categoría es obligatoria.');
      }

      const data = new FormData()

      // --- PRIORIDAD MÁXIMA: Mandamos las viejas PRIMERO para que el servidor no las pierda ---
      if (esEdicion) {
        imgExistentes.forEach(url => data.append('galeriaPersistente', url))
      }

      Object.entries(form).forEach(([k, v]) => {
        if (Array.isArray(v)) {
          v.forEach(item => data.append(k, item))
        } else {
          data.append(k, v)
        }
      })
      imagenes.forEach((img, i) => data.append('imagenes', img, img.name || `producto_${i}.jpg`))
      
      if (guiaTallesImg) {
        data.append('guiaTallesImg', guiaTallesImg, guiaTallesImg.name || 'guia_talles.jpg')
      }

      const url    = esEdicion
        ? `${BASE_URL}/products/${id}`
        : `${BASE_URL}/products/create`
      const method = esEdicion ? 'PUT' : 'POST'

      const res = await fetch(url, { 
        method, 
        headers: { ...getAuthHeaders() },
        body: data 
      })

      const resData = await res.json()
      if (!res.ok) {
        // Priorizamos el mensaje más descriptivo que venga del backend
        const desc = resData.mensaje || resData.error || 'Error al guardar producto'
        throw new Error(desc)
      }
      setExito(true)
      setTimeout(() => navigate('/admin/productos'), 1500)
    } catch (err) {
      console.error('Error saving product:', err)
      
      let mensajeError = err.message
      if (err.message === 'Failed to fetch') {
        mensajeError = 'Error de red o el servidor no responde. Verificá tu conexión.'
      }
      
      setError(mensajeError)
      setLoading(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  if (loadingData) return (
    <div className="admin-loading">Cargando producto...</div>
  )

  return (
    <div className="admin-nuevo">
      <div className="admin-page-header">
        <div>
          <button
            className="admin-back-btn"
            onClick={() => navigate('/admin/productos')}
          >
            ← Volver
          </button>
          <h2 className="admin-page-title">
            {esEdicion ? 'Editar Producto' : 'Agregar Nuevo Producto'}
          </h2>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="admin-form">

        {/* ── Detalles principales ── */}
        <div className="admin-card">
          <h3 className="admin-card__title">Detalles principales</h3>
          <div className="admin-form-row">
            <div className="admin-field">
              <label>Nombre del Producto</label>
              <input
                name="nombre"
                value={form.nombre}
                onChange={handleChange}
                placeholder="Ej: Vintage Carhartt Jacket"
                required
              />
            </div>
            <div className="admin-field">
              <label>Precio ($)</label>
              <input
                name="precio"
                type="number"
                value={form.precio}
                onChange={handleChange}
                placeholder="Ej: 15000"
                required
              />
            </div>
            <div className="admin-field">
              <label>Precio de Oferta ($)</label>
              <input
                name="precioOferta"
                type="number"
                value={form.precioOferta}
                onChange={handleChange}
                placeholder="Opcional. Ej: 12000"
              />
            </div>
          </div>

          <div className="admin-form-row" style={{marginTop: '1rem'}}>
            <div className="admin-field">
              <label>Categoría</label>
              <select name="categoria" value={form.categoria} onChange={handleChange} required>
                <option value="">Seleccioná una categoría</option>
                {realCategories.map(c => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label>Corte / Tipo</label>
              <select name="tipo" value={form.tipo} onChange={handleChange}>
                <option value="oversize">Oversize</option>
                <option value="baggy">Baggy</option>
                <option value="regular">Regular</option>
                <option value="slim">Slim</option>
                <option value="chaqueta">Chaqueta</option>
                <option value="no aplica">No aplica</option>
              </select>
            </div>
          </div>
          <div className="admin-field" style={{marginTop: '1rem'}}>
            <label>Descripción</label>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              placeholder="Describí el producto, materiales, medidas..."
            />
          </div>

          <div className="admin-field" style={{marginTop: '1rem'}}>
            <label>Guía de Talles (Texto o Imagen)</label>
            <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
              <textarea
                name="guiaTalles"
                value={form.guiaTalles?.startsWith('http') ? '' : form.guiaTalles}
                onChange={handleChange}
                placeholder="Escribí las medidas aquí..."
                rows="3"
                disabled={Boolean(guiaTallesImg || (esEdicion && form.guiaTalles?.startsWith('http') && !guiaTallesImg))}
              />
              
              <div className="guia-img-upload">
                {(guiaTallesPreview || (form.guiaTalles?.startsWith('http'))) && (
                  <div className="img-preview" style={{width: '200px', marginBottom: '0.5rem'}}>
                    <img src={guiaTallesPreview || form.guiaTalles} alt="Guía de talles" />
                    <button 
                      type="button" 
                      className="admin-img-action admin-img-action--remove" 
                      onClick={() => {
                        setGuiaTallesImg(null)
                        setGuiaTallesPreview('')
                        if(form.guiaTalles?.startsWith('http')) setForm(p => ({...p, guiaTalles: ''}))
                      }}
                    >✕</button>
                  </div>
                )}
                
                <label className="admin-btn-secondary" style={{display: 'inline-block', cursor: 'pointer', padding: '0.5rem 1rem'}}>
                  <input type="file" accept="image/*" onChange={handleGuiaTallesImg} style={{display: 'none'}} />
                  {form.guiaTalles?.startsWith('http') || guiaTallesImg ? 'Cambiar Imagen de Guía' : 'Subir Imagen de Guía'}
                </label>
              </div>
            </div>
          </div>

          <div className="admin-form-row" style={{marginTop: '1rem'}}>
            <div className="admin-field">
              <label>Stock Total (Informativo)</label>
              <input
                name="stock"
                type="number"
                value={form.stock}
                onChange={handleChange}
                min="0"
              />
            </div>
          </div>
          <div className="admin-checkboxes">
            <label className="admin-checkbox">
              <input
                type="checkbox"
                name="publicado"
                checked={form.publicado}
                onChange={handleChange}
              />
              <span style={{whiteSpace: 'nowrap'}}>Publicado (visible en la tienda)</span>
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                name="esNuevoDrop"
                checked={form.esNuevoDrop}
                onChange={handleChange}
              />
              <span style={{whiteSpace: 'nowrap'}}>Marcar como Nuevo Drop</span>
            </label>
          </div>
        </div>

        {/* ── Talles ── */}
        <div className="admin-card">
          <h3 className="admin-card__title">Talles disponibles</h3>
          {!form.categoria ? (
            <p style={{color: '#666', fontSize: '0.9rem'}}>Seleccioná una categoría para ver los talles disponibles.</p>
          ) : (
            <div className="talles-global-selector">
              {Object.entries(SIZES_BY_CATEGORY)
                .filter(([catName]) => {
                  // Filtramos para mostrar solo la categoría que coincida con el nombre de la categoría seleccionada
                  if (!activeCatObj) return true; // Si no hay objeto de categoría, mostramos todo por seguridad
                  const dbName = activeCatObj.name.toLowerCase();
                  return dbName.includes(catName.toLowerCase());
                })
                .map(([catName, sizes]) => (
                  <div key={catName} className="talle-group">
                    <p className="talle-group__name">{catName}</p>
                    <div className="talles-selector">
                      {sizes.map(t => (
                        <button
                          key={t}
                          type="button"
                          className={`talle-chip ${form.talles.includes(t) ? 'talle-chip--active' : ''}`}
                          onClick={() => handleTalle(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* ── Imágenes ── */}
        <div className="admin-card">
          <h3 className="admin-card__title">Imágenes del Producto</h3>

          {/* Imágenes ya existentes (modo edición) */}
          {imgExistentes.length > 0 && (
            <div className="img-grid" style={{marginBottom: '1rem'}}>
              {imgExistentes.map((url, i) => (
                <div key={i} className="img-preview img-preview--existente">
                  <img src={url} alt={`Imagen ${i+1}`} />
                  <span className="img-preview__tag">Guardada</span>
                  <button 
                    type="button" 
                    className="admin-img-action admin-img-action--remove" 
                    onClick={() => setImgExistentes(prev => prev.filter(x => x !== url))}
                    title="Eliminar de la galería"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Previews de nuevas imágenes */}
          {previews.length > 0 && (
            <div className="img-grid" style={{marginBottom: '1rem'}}>
              {previews.map((url, i) => (
                <div key={i} className="img-preview">
                  <img src={url} alt={`Preview ${i+1}`} />
                </div>
              ))}
            </div>
          )}

          {/* Upload */}
          <label className="img-upload">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImagenes}
              style={{display: 'none'}}
            />
            <div className="img-upload__inner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>Subir imágenes</span>
              <small>JPG, PNG, WEBP</small>
            </div>
          </label>
        </div>

        {/* ── Acciones ── */}
        {error  && <p className="admin-form__error">{error}</p>}
        {exito  && <p className="admin-form__exito">✓ Producto guardado. Redirigiendo...</p>}

        <div className="admin-form__actions">
          <button
            type="button"
            className="admin-btn-secondary"
            onClick={() => navigate('/admin/productos')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="admin-btn-primary"
            style={{ background: '#7b1fa2' }}
            disabled={loading}
          >
            {loading ? 'Subiendo fotos (no cierres)...' : (esEdicion ? 'Guardar Cambios' : 'Guardar Producto')}
          </button>
        </div>

      </form>
    </div>
  )
}