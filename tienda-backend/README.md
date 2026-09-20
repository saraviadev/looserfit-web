# Looserfit Backend API 🚀

Este es el backend de la plataforma de e-commerce **Looserfit**, construido con una arquitectura robusta de Capa de Servicios (Service Layer) para garantizar escalabilidad y mantenibilidad.

## 🛠️ Tecnologías
- **Node.js & Express**: Framework de servidor.
- **MongoDB & Mongoose**: Base de datos NoSQL y modelado de datos.
- **JWT (JSON Web Token)**: Autenticación segura.
- **Bcrypt.js**: Hasheo de contraseñas.
- **Cloudinary**: Gestión y almacenamiento de imágenes.
- **Nodemailer**: Sistema de notificaciones por email.
- **Mercado Pago SDK**: Integración de pagos.

## 🏗️ Arquitectura del Proyecto
El proyecto sigue el patrón **Route - Controller - Service**:

- **Routes (`src/routes/`)**: Definen los endpoints y aplican middlewares de seguridad.
- **Controllers (`src/controllers/`)**: Manejan las peticiones HTTP y las respuestas.
- **Services (`src/services/`)**: Contienen toda la lógica de negocio y comunicación con la base de datos.
- **Models (`src/models/`)**: Esquemas de Mongoose para la base de datos.

## 📦 Entidades Principales
- **Products**: Gestión de stock, precios de oferta y categorías.
- **Categories**: Entidad independiente referenciada en productos para una mejor organización.
- **Users**: Registro, login y roles (Admin/User).
- **Orders**: Gestión de pedidos, comprobantes de pago y seguimiento.

## 🚀 Instalación y Uso

1. Clonar el repositorio.
2. Instalar dependencias: `npm install`.
3. Configurar el archivo `.env` basado en `.env.example`:
   - `MONGO_URI`: Conexión de MongoDB Atlas.
   - `JWT_SECRET`: Llave secreta para tokens de autenticación.
   - `RESEND_API_KEY`: API Key de Resend (recomendado en producción para evitar bloqueos SMTP en Render).
   - `EMAIL_FROM`: Remitente verificado en Resend (ej: `Looserfit <pedidos@looserfit.com>`).
   - `EMAIL_USER`, `EMAIL_PASS`: Credenciales de Gmail (utilizadas como fallback SMTP en entorno local).
   - `SITE_FRONTEND_URL` / `FRONTEND_URL`: URL pública de la tienda (`https://www.looserfit.com`).
   - `MP_PUBLIC_KEY`, `MP_ACCESS_TOKEN`: Credenciales de Mercado Pago.
   - `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`: Credenciales de ImageKit.
4. Ejecutar tests automatizados: `npm test`.
5. Probar envío de correos manualmente:
   ```bash
   TEST_EMAIL_TO="tu_correo@ejemplo.com" node scripts/send-test-emails.js
   ```
6. Iniciar en modo desarrollo: `npm run dev`.

## 📖 Endpoints Principales
- `POST /api/auth/login`: Inicio de sesión.
- `GET /api/products/all`: Obtener todos los productos (con categorías pobladas).
- `GET /api/categories`: Listado de categorías.
- `POST /api/orders/create`: Generación de nuevo pedido/ticket.
- `POST /api/admin/newsletter`: Envío masivo de noticias a usuarios.

---
*Desarrollado para Looserfit - Tienda de Indumentaria.*
