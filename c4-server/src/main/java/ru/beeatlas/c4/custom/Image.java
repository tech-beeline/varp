package ru.beeatlas.c4.custom;

public record Image(
        String id,
        String slug,
        String name, 
        String distribution,
        String version,
        Number min_disk) {
}