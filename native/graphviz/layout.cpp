#include <cgraph.h>
#include <gvc.h>
#include <gvplugin.h>
#include <utils.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

extern "C" {
extern gvplugin_library_t gvplugin_dot_layout_LTX_library;
}

namespace {

thread_local std::string lastError;

/** Appends a JSON string literal, escaping quotes, backslashes and control characters. */
void appendQuoted(std::string& out, const char* value)
{
    out.push_back('"');
    if (value != nullptr) {
        for (const unsigned char* p = reinterpret_cast<const unsigned char*>(value); *p != '\0'; ++p) {
            switch (*p) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (*p < 0x20) {
                    char buffer[8];
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", *p);
                    out += buffer;
                } else {
                    out.push_back(static_cast<char>(*p));
                }
            }
        }
    }
    out.push_back('"');
}

/** Appends `,"name":"value"` unless the attribute is missing. */
void appendAttribute(std::string& out, const char* name, const char* value)
{
    if (value == nullptr || value[0] == '\0') return;
    out += ',';
    appendQuoted(out, name);
    out += ':';
    appendQuoted(out, value);
}

const char* attribute(void* object, const char* name)
{
    return agget(object, const_cast<char*>(name));
}

/** Collects the graph ids of every node inside a cluster, including nested clusters. */
void collectClusterNodes(Agraph_t* cluster, const std::unordered_map<Agnode_t*, int>& ids, std::vector<int>& nodes)
{
    for (Agnode_t* node = agfstnode(cluster); node != nullptr; node = agnxtnode(cluster, node)) {
        const auto found = ids.find(node);
        if (found != ids.end()) nodes.push_back(found->second);
    }
    for (Agraph_t* child = agfstsubg(cluster); child != nullptr; child = agnxtsubg(child)) {
        collectClusterNodes(child, ids, nodes);
    }
}

/** Emits a cluster and its nested clusters, in declaration order. */
void emitClusters(
    std::vector<std::string>& out,
    Agraph_t* parent,
    const std::unordered_map<Agnode_t*, int>& ids,
    int& nextClusterId)
{
    for (Agraph_t* cluster = agfstsubg(parent); cluster != nullptr; cluster = agnxtsubg(cluster)) {
        std::string chunk;
        chunk += "{\"_gvid\":";
        chunk += std::to_string(nextClusterId++);
        chunk += ",\"name\":";
        appendQuoted(chunk, agnameof(cluster));
        appendAttribute(chunk, "bb", attribute(cluster, "bb"));

        std::vector<int> nodes;
        collectClusterNodes(cluster, ids, nodes);
        chunk += ",\"nodes\":[";
        for (size_t index = 0; index < nodes.size(); ++index) {
            if (index > 0) chunk += ',';
            chunk += std::to_string(nodes[index]);
        }
        chunk += "]}";
        out.push_back(std::move(chunk));

        emitClusters(out, cluster, ids, nextClusterId);
    }
}

std::string emitLayout(Agraph_t* graph)
{
    std::vector<Agnode_t*> nodes;
    std::unordered_map<Agnode_t*, int> ids;
    for (Agnode_t* node = agfstnode(graph); node != nullptr; node = agnxtnode(graph, node)) {
        ids[node] = static_cast<int>(nodes.size());
        nodes.push_back(node);
    }

    std::string out = "{\"objects\":[";
    bool firstObject = true;

    for (size_t index = 0; index < nodes.size(); ++index) {
        Agnode_t* node = nodes[index];
        if (!firstObject) out += ',';
        firstObject = false;
        out += "{\"_gvid\":";
        out += std::to_string(static_cast<int>(index));
        out += ",\"id\":";
        const char* id = attribute(node, "id");
        appendQuoted(out, id != nullptr ? id : agnameof(node));
        appendAttribute(out, "pos", attribute(node, "pos"));
        appendAttribute(out, "width", attribute(node, "width"));
        appendAttribute(out, "height", attribute(node, "height"));
        out += '}';
    }

    int nextClusterId = static_cast<int>(nodes.size());
    std::vector<std::string> clusters;
    emitClusters(clusters, graph, ids, nextClusterId);
    for (const std::string& cluster : clusters) {
        if (!firstObject) out += ',';
        firstObject = false;
        out += cluster;
    }

    out += "],\"edges\":[";
    bool firstEdge = true;
    for (Agnode_t* node = agfstnode(graph); node != nullptr; node = agnxtnode(graph, node)) {
        for (Agedge_t* edge = agfstout(graph, node); edge != nullptr; edge = agnxtout(graph, edge)) {
            if (!firstEdge) out += ',';
            firstEdge = false;
            out += "{\"id\":";
            appendQuoted(out, attribute(edge, "id"));
            out += ",\"tail\":";
            out += std::to_string(ids[agtail(edge)]);
            out += ",\"head\":";
            out += std::to_string(ids[aghead(edge)]);
            appendAttribute(out, "pos", attribute(edge, "pos"));
            out += '}';
        }
    }

    out += "]}";
    return out;
}

} // namespace

extern "C" {

/** Lays out a DOT graph with the dot engine and returns the geometry as JSON. */
const char* layout_json(const char* dot)
{
    lastError.clear();
    if (dot == nullptr) {
        lastError = "no DOT input";
        return nullptr;
    }

    GVC_t* context = gvContext();
    if (context == nullptr) {
        lastError = "cannot create a graphviz context";
        return nullptr;
    }
    gvAddLibrary(context, &gvplugin_dot_layout_LTX_library);

    Agraph_t* graph = agmemread(dot);
    if (graph == nullptr) {
        gvFreeContext(context);
        lastError = "cannot parse the DOT input";
        return nullptr;
    }

    if (gvLayout(context, graph, "dot") != 0) {
        agclose(graph);
        gvFreeContext(context);
        lastError = "dot layout failed";
        return nullptr;
    }

    attach_attrs_and_arrows(graph, nullptr, nullptr);
    const std::string json = emitLayout(graph);

    gvFreeLayout(context, graph);
    agclose(graph);
    gvFreeContext(context);

    char* result = static_cast<char*>(std::malloc(json.size() + 1));
    if (result == nullptr) {
        lastError = "out of memory";
        return nullptr;
    }
    std::memcpy(result, json.c_str(), json.size() + 1);
    return result;
}

/** Releases a string returned by layout_json. */
void layout_free(const char* value)
{
    std::free(const_cast<char*>(value));
}

/** Message of the last failed layout_json call. */
const char* layout_last_error()
{
    return lastError.c_str();
}

} // extern "C"

#ifndef __EMSCRIPTEN__

int main(int argc, char** argv)
{
    const bool fromStdin = argc < 2 || std::strcmp(argv[1], "-") == 0;
    std::string dot;
    char buffer[4096];
    size_t read;

    if (fromStdin) {
        while ((read = std::fread(buffer, 1, sizeof(buffer), stdin)) > 0) {
            dot.append(buffer, read);
        }
    } else {
        std::FILE* file = std::fopen(argv[1], "rb");
        if (file == nullptr) {
            std::fprintf(stderr, "cannot open %s\n", argv[1]);
            return 2;
        }
        while ((read = std::fread(buffer, 1, sizeof(buffer), file)) > 0) {
            dot.append(buffer, read);
        }
        std::fclose(file);
    }

    const char* json = layout_json(dot.c_str());
    if (json == nullptr) {
        std::fprintf(stderr, "%s\n", layout_last_error());
        return 1;
    }
    std::fputs(json, stdout);
    std::fputc('\n', stdout);
    layout_free(json);
    return 0;
}

#endif
