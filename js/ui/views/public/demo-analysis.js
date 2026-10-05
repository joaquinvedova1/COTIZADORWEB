/**
 * Análisis completo del ejemplo (#/demo/analisis), público y sin cuenta.
 *
 * Usa el contexto de demo (en memoria, app.demo()): la misma pantalla de
 * resultado que ve una cuenta, con valores ILUSTRATIVOS, sin guardar nada
 * en el navegador ni en la nube. No permite cambiar el estado de la
 * cotización (es sólo para explorar).
 */

import { h, mount } from '../../dom.js';
import { banner } from '../../components.js';
import { logger } from '../../../core/logger.js';
import { userErrorMessage } from '../../layout.js';
import { registerHash } from '../../../services/auth-routing.js';
import { renderQuoteResult } from '../quote-result.js';
import { flowHeader, headerLink, isSignedIn, pubLink } from './public-chrome.js';

export async function render(root, app) {
  app.setHeader({ title: 'Ejemplo: análisis completo' });
  const signedIn = isSignedIn(app);
  const header = flowHeader({
    actions: [
      headerLink('Volver a la demo', '#/demo?paso=4', { iconBefore: 'arrowLeft' }),
      signedIn
        ? pubLink('Abrir RATEOS', '#/inicio', { tone: 'primary', size: 'md' })
        : pubLink('Crear cuenta', registerHash('/cotizaciones/nueva'), { tone: 'primary', size: 'md' }),
    ],
  });
  const body = h('div', { class: 'pub-container pub-demo-analysis' });
  mount(root, h('div', { class: 'pub-page' }, header, h('main', { class: 'pub-demo-analysis-main' },
    h('h1', { class: 'pub-flow-title', tabindex: '-1' }, 'Ejemplo: Hidrogrúa on-call — Añelo'),
    h('p', { class: 'pub-flow-text' }, 'El análisis completo de la cotización de ejemplo. Valores ILUSTRATIVOS: no se guarda nada y no hace falta cuenta.'),
    body)));

  try {
    const demo = await app.demo();
    const { quote } = await demo.quotes.getDemoQuote();
    const settings = await demo.settings.get();
    const result = await demo.quotes.compute(quote);
    return renderQuoteResult(body, app, { quote, result, settings });
  } catch (error) {
    logger.warn('No se pudo mostrar el análisis del ejemplo', { name: error && error.name });
    mount(body, banner(userErrorMessage(error, 'No se pudo mostrar el ejemplo. Recargá la página.'), 'danger'));
    return () => {};
  }
}
