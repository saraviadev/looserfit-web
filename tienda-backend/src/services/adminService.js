const User = require('../models/User');
const { sendEmail, wrapHTML } = require('../config/email');

const enviarNewsletter = async (asunto, contenido) => {
    const users = await User.find({}, 'email');
    const emails = users.map(u => u.email).filter(Boolean);

    if (emails.length === 0) return { mensaje: 'No hay usuarios suscritos' };

    try {
        await sendEmail({
            bcc: emails,
            subject: asunto,
            html: wrapHTML(
                asunto,
                `<div style="font-size: 16px; line-height: 1.6; color: #333;">
                    ${contenido.replace(/\n/g, '<br>')}
                </div>`
            )
        });
        return { mensaje: `Noticia enviada correctamente a ${emails.length} usuarios.` };
    } catch (err) {
        console.error('❌ [Email Error] tipo: Newsletter | error:', err.message);
        throw err;
    }
};

module.exports = {
    enviarNewsletter
};
