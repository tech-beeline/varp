package ru.beeatlas.c4.custom;

public record Region(
        String id,
        String slug,
        String name, 
        String location,
        String hypervisor,
        String zone,
        Number priority) {
}
