"use strict";

/**
 * Limitador em memoria (janela deslizante). Vale por instancia da Function:
 * freia abuso simples, mas nao e um limite global. Para producao seria,
 * use Firebase App Check e/ou Cloud Armor.
 */
class RateLimiter {
  constructor(maximo, janelaMs) {
    this.maximo = maximo;
    this.janelaMs = janelaMs;
    this.acessos = new Map();
  }

  permitir(chave) {
    const agora = Date.now();
    const fila = (this.acessos.get(chave) || []).filter((t) => agora - t <= this.janelaMs);
    if (fila.length >= this.maximo) {
      this.acessos.set(chave, fila);
      return false;
    }
    fila.push(agora);
    this.acessos.set(chave, fila);
    if (this.acessos.size > 5000) {
      for (const [k, v] of this.acessos) if (!v.some((t) => agora - t <= this.janelaMs)) this.acessos.delete(k);
    }
    return true;
  }
}

module.exports = RateLimiter;
