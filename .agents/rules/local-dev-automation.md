# REGLA DE AUTOMATIZACIÓN LOCAL PROACTIVA (LOOSERFIT & GLOBAL)

## DIRECTIVA OBLIGATORIA DEL USUARIO:
1. **Ejecución Automática Proactiva:**
   Cuando el usuario solicite ver, probar, inspeccionar o verificar cualquier sección, endpoint o flujo en local:
   - **NUNCA** le pidas al usuario que abra terminales ni que ejecute comandos manualmente (`npm run dev`, `npm start`, etc.).
   - **SIEMPRE** levantá vos mismo los servidores en segundo plano utilizando `run_command` con `IsDaemon: true` (Backend en `http://localhost:3000` y Frontend en `http://localhost:5173`).
   - Verificá que los procesos y puertos respondan correctamente.
   - Entregá directamente los enlaces locales (`http://localhost:5173/...`) listos para que el usuario haga click y pruebe en su navegador.

2. **Cero Fricción:**
   Cualquier script, verificación de base de datos, prueba de frontend o backend que deba ejecutarse, ejecutala directamente con tus herramientas sin pedirle al usuario que lo haga manualmente.
