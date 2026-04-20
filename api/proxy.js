const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const dohProviders = {
    cloudflare: 'https://cloudflare-dns.com/dns-query',
    google: 'https://dns.google/resolve',
    quad9: 'https://dns.quad9.net/dns-query',
    adguard: 'https://dns.adguard.com/dns-query'
};

async function resolveDoH(domain, providerKey) {
    const providerUrl = dohProviders[providerKey] || dohProviders['cloudflare'];
    try {
        const response = await axios.get(providerUrl, {
            params: { name: domain, type: 'A' },
            headers: { 'Accept': 'application/dns-json' }
        });
        if (response.data.Answer && response.data.Answer.length > 0) {
            return response.data.Answer[0].data;
        }
        throw new Error("Domínio não resolvido via DoH");
    } catch (error) {
        throw error;
    }
}

// A Rota agora é /api/proxy para seguir o padrão da Vercel
app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    const dohProvider = req.query.doh || 'cloudflare';

    if (!targetUrl) return res.status(400).send('URL não fornecida.');

    try {
        const parsedUrl = new URL(targetUrl);
        const domain = parsedUrl.hostname;
        
        // Resolve o IP (DoH)
        const ipAddress = await resolveDoH(domain, dohProvider);
        
        const headers = {
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
            'Accept-Language': req.headers['accept-language'],
            'Host': domain
        };

        const response = await axios.get(targetUrl, {
            headers: headers,
            responseType: 'arraybuffer',
            validateStatus: () => true
        });

        const contentType = response.headers['content-type'] || '';
        res.set('Content-Type', contentType);
        
        if (contentType.includes('text/html')) {
            const html = response.data.toString('utf-8');
            const $ = cheerio.load(html);
            // Atualizamos a URL base para as reescritas
            const proxyBase = `/api/proxy?doh=${dohProvider}&url=`;

            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    const absoluteUrl = new URL(href, targetUrl).href;
                    $(el).attr('href', proxyBase + encodeURIComponent(absoluteUrl));
                }
            });

            $('img, script, iframe').each((i, el) => {
                const src = $(el).attr('src');
                if (src && !src.startsWith('data:')) {
                    const absoluteUrl = new URL(src, targetUrl).href;
                    $(el).attr('src', proxyBase + encodeURIComponent(absoluteUrl));
                }
            });

            $('link[rel="stylesheet"]').each((i, el) => {
                const href = $(el).attr('href');
                if (href) {
                    const absoluteUrl = new URL(href, targetUrl).href;
                    $(el).attr('href', proxyBase + encodeURIComponent(absoluteUrl));
                }
            });

            $('form').each((i, el) => {
                const action = $(el).attr('action') || targetUrl;
                const absoluteUrl = new URL(action, targetUrl).href;
                $(el).attr('action', proxyBase + encodeURIComponent(absoluteUrl));
            });

            return res.send($.html());
        } else {
            return res.send(response.data);
        }

    } catch (error) {
        res.status(500).send(`Erro ao processar a página: ${error.message}`);
    }
});

// Isso permite rodar localmente (node api/proxy.js) E funcionar na Vercel
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Rodando localmente na porta ${PORT}`));
}

// Exportação obrigatória para a Vercel entender que é uma função Serverless
module.exports = app;
