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

package ru.beeatlas.c4.utils;

/**
 * Some constants used when applying graphviz.
 */
class Constants {

    // diagrams created by the Structurizr cloud service/on-premises installation/Lite are sized for 300dpi
    static final double STRUCTURIZR_DPI = 300.0;

    // graphviz uses 72dpi by default
    private static final double GRAPHVIZ_DPI = 72.0;

    // this is needed to convert coordinates provided by graphviz, to those used by Structurizr
    static final double DPI_RATIO = STRUCTURIZR_DPI / GRAPHVIZ_DPI;

}