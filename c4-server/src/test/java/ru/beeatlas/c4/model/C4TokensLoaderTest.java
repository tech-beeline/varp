package ru.beeatlas.c4.model;

import org.junit.jupiter.api.Test;

public class C4TokensLoaderTest {

    @Test
    public void load() {
        C4TokensLoader tokensLoader = new C4TokensLoader();
        tokensLoader.readConfiguration();
    }

}
