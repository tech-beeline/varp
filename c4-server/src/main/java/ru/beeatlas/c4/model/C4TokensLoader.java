package ru.beeatlas.c4.model;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;

import com.google.gson.Gson;

public class C4TokensLoader {

    private final static String TOKEN_CONFIG = "config/c4tokens.json";

    public C4TokensConfig readConfiguration() {
        InputStream configIs = this.getClass().getClassLoader().getResourceAsStream(TOKEN_CONFIG);
        Reader reader = new InputStreamReader(configIs);
        return (new Gson()).fromJson(reader, C4TokensConfig.class);
    }

}
