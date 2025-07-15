package ru.beeatlas.c4.custom;

public record Technology(/*Integer id,*/
        String label,/* 
        Boolean review,
        String description,
        String link,
        String createdDate,
        String deletedDate,
        String lastModifiedDate,*/
        Ring ring/*,
        Sector sector,
        List<Category> category,
        List<Object> version*/) {
    public record Ring(/*Integer id,*/ String name/*, Integer order*/) {
    }

    /*
    public record Sector(Integer id, String name, Integer order) {
    }

    public record Category(Integer id, String name, Integer order) {
    }
    */
}