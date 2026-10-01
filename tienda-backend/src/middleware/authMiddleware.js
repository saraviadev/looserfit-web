const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const protect = (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ error: 'No autorizado, falta el token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
        req.user = decoded;
        next();
    } catch (_e) {
        return res.status(401).json({ error: 'Token no válido' });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        return res.status(403).json({ error: 'Acceso denegado: se requieren permisos de administrador' });
    }
};

module.exports = { protect, adminOnly };
