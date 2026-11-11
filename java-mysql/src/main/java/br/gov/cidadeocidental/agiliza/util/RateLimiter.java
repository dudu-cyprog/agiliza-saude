package br.gov.cidadeocidental.agiliza.util;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/** Limitador simples em memoria (janela deslizante) contra forca bruta. */
public final class RateLimiter {

    private final int maximo;
    private final long janelaMs;
    private final ConcurrentHashMap<String, Deque<Long>> acessos = new ConcurrentHashMap<>();

    public RateLimiter(int maximo, long janelaMs) {
        this.maximo = maximo;
        this.janelaMs = janelaMs;
    }

    /** @return true se a chave ainda pode tentar. */
    public boolean permitir(String chave) {
        long agora = System.currentTimeMillis();
        Deque<Long> fila = acessos.computeIfAbsent(chave, k -> new ArrayDeque<>());
        synchronized (fila) {
            while (!fila.isEmpty() && agora - fila.peekFirst() > janelaMs) {
                fila.pollFirst();
            }
            if (fila.size() >= maximo) {
                return false;
            }
            fila.addLast(agora);
            return true;
        }
    }
}
