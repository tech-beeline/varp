/*
    Copyright 2025 VimpelCom PJSC

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

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