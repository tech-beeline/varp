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

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.cert.X509Certificate;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import java.util.stream.Collectors;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import org.eclipse.lsp4j.CodeLens;
import org.eclipse.lsp4j.Command;
import org.eclipse.lsp4j.CompletionItem;
import org.eclipse.lsp4j.CompletionItemKind;
import org.eclipse.lsp4j.CompletionItemLabelDetails;
import org.eclipse.lsp4j.Hover;
import org.eclipse.lsp4j.MarkupContent;
import org.eclipse.lsp4j.MarkupKind;
import org.eclipse.lsp4j.Position;
import org.eclipse.lsp4j.Range;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.google.gson.Gson;
import com.structurizr.Workspace;
import com.structurizr.model.Container;
import com.structurizr.model.Element;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.PatternLayout;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.FileAppender;
import ch.qos.logback.core.encoder.LayoutWrappingEncoder;
import ru.beeatlas.c4.utils.C4Utils;
import ru.beeatlas.c4.model.C4DocumentModel;
import ru.beeatlas.c4.model.C4ObjectWithContext;
import ru.beeatlas.c4.model.C4DocumentModel.C4CompletionScope;
import ru.beeatlas.c4.utils.LineToken;
import ru.beeatlas.c4.utils.LineTokenizer;
import ru.beeatlas.c4.utils.LineTokenizer.CursorLocation;
import ru.beeatlas.c4.provider.C4CompletionItemCreator;

public class Custom {

    private static final Logger logger = LoggerFactory.getLogger(Custom.class);    

    private PatternLayout pattern = new PatternLayout();
    private LayoutWrappingEncoder<ILoggingEvent> encoder = new LayoutWrappingEncoder<ILoggingEvent>();
    private FileAppender<ILoggingEvent> fileAppender = new FileAppender<ILoggingEvent>();    

    private HostnameVerifier allTrustingHostnameVerifier = null;
    private SSLSocketFactory allTrustingTrustManager = null;
    private boolean noTLS = false;
    private boolean serverLogsEnabled = false;
    private boolean started = false;

    private String lastHover = "";
    private String username = "unknown";
    private String beelineApiUrl = "";
    private String beelineApiSecret = "";
    private String beelineApiKey = "";
    private String beelineCloudUrl = "";
    private String beelineCloudToken = "";
    private String glossaries = "";
    private String ver = "1.0.0";
    private String cmdb = "";

    private AtomicReference<Map<String, Capability>> capabilities = new AtomicReference<>(Collections.emptyMap());
    private AtomicReference<Map<String, TechCapability>> techCapabilities = new AtomicReference<>(Collections.emptyMap());    
    private AtomicReference<Map<String, Technology>> technologies = new AtomicReference<>(Collections.emptyMap());
    private AtomicReference<Map<String, Term>> terms = new AtomicReference<>(Collections.emptyMap());

    private Map<String, List<CompletionItem>> beelineCloudRegions = new HashMap<>();
    private Map<String, List<CompletionItem>> beelineCloudFlavors = new HashMap<>();
    private Map<String, List<CompletionItem>> beelineCloudImages = new HashMap<>();

    private final static String TECH_PATTERN = "tech:";
    private Map<String, String> adrs = new HashMap<>();

    private static final Custom INSTANCE = new Custom();    

    public void setBeelineApiSecret(String beelineApiSecret) {
        this.beelineApiSecret = beelineApiSecret;
    }

    public void setBeelineApiKey(String beelineApiKey) {
        this.beelineApiKey = beelineApiKey;
    }

    private boolean isValidURL(String url) {
        try {
            new URL(url).toURI();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private HttpsURLConnection beelineApiConnection(String method, String path, String body, String contentType) throws IOException {
        HttpsURLConnection conn = (HttpsURLConnection) new URL(beelineApiUrl + path).openConnection();
        conn.setRequestMethod(method);
        if(contentType != null) {
            conn.setRequestProperty("Content-Type", contentType);
        } else {
            contentType = "";
        }
        if(noTLS) {
            conn.setHostnameVerifier(allTrustingHostnameVerifier);
            conn.setSSLSocketFactory(allTrustingTrustManager);
        }
        if(!beelineApiKey.isEmpty() && !beelineApiSecret.isEmpty()) {
            try {
                body = (body == null) ? "" : HashBasedMessageAuthenticationCode.md5(body);
                String nonce = Long.toString(System.currentTimeMillis());
                HashBasedMessageAuthenticationCode code = new HashBasedMessageAuthenticationCode(beelineApiSecret);
                HmacContent hmacContent = new HmacContent(method, path, body, contentType, nonce);
                String generatedHmac = code.generate(hmacContent.toString());                
                String xauth = beelineApiKey + ":" + Base64.getEncoder().encodeToString(generatedHmac.getBytes());
                conn.setRequestProperty("X-Authorization", xauth);
                conn.setRequestProperty("Nonce", nonce);
            } catch (Exception e) {
            }
        }
        return conn;
    }

    private HttpsURLConnection beelineCloudConnection(String method, String path) throws IOException {
        HttpsURLConnection conn = (HttpsURLConnection) new URL(beelineCloudUrl + path).openConnection();
        conn.setRequestMethod(method);
        if(noTLS) {
            conn.setHostnameVerifier(allTrustingHostnameVerifier);
            conn.setSSLSocketFactory(allTrustingTrustManager);
        }
        conn.setRequestProperty("accept", "application/json");
        if(!beelineCloudToken.isEmpty()) {
            conn.setRequestProperty("Authorization", beelineCloudToken);
        }
        return conn;
    }

    public Custom() {

        String username = null;

        try {
            username = System.getProperty("user.name");
        } catch (Exception e) {
        }

        if (username == null) {
            try {
                username = System.getenv("USERNAME");
            } catch (Exception e) {
            }
        }

        if (username == null) {
            try {
                username = System.getenv("USER");
            } catch (Exception e) {
            }
        }

        this.username = (username == null) ? "unknown" : username.toLowerCase();          

        try {
            // Create a trust manager that does not validate certificate chains
            TrustManager[] trustAllCerts = new TrustManager[] {
                    new X509TrustManager() {
                        public java.security.cert.X509Certificate[] getAcceptedIssuers() {
                            return null;
                        }

                        @Override
                        public void checkClientTrusted(X509Certificate[] certs, String authType) {
                        }

                        @Override
                        public void checkServerTrusted(X509Certificate[] certs, String authType) {
                        }
                    } };

            SSLContext sc = SSLContext.getInstance("SSL");
            sc.init(null, trustAllCerts, new java.security.SecureRandom());
            allTrustingTrustManager = sc.getSocketFactory();
            allTrustingHostnameVerifier = new HostnameVerifier() {
                public boolean verify(String hostname, SSLSession session) {
                    return true;
                }
            };
        } catch (Exception e) {
        }
        
        LoggerContext loggerContext = (LoggerContext) LoggerFactory.getILoggerFactory();
        pattern.setContext(loggerContext);
        pattern.setPattern("%d{HH:mm:ss.SSS} [%thread] %-5level %logger{35} - %msg%n");
        pattern.start();

        encoder.setContext(loggerContext);
        encoder.setCharset(Charset.forName("utf-8"));
        encoder.setLayout(pattern);

        fileAppender.setFile("c4-language-server.log");
        fileAppender.setEncoder(encoder);
        fileAppender.setContext(loggerContext);
        fileAppender.setAppend(false);        
    }

    public void setGlossaries(String glossaries) {
        if(this.glossaries != glossaries) {
            this.glossaries = glossaries;
            updateTerms();
        }        
    }

    public void setServerLogsEnabled(boolean serverLogsEnabled) {
        if(this.serverLogsEnabled != serverLogsEnabled) {
            this.serverLogsEnabled = serverLogsEnabled;
            LoggerContext loggerContext = (LoggerContext) LoggerFactory.getILoggerFactory(); 
            ch.qos.logback.classic.Logger log = loggerContext.getLogger(Logger.ROOT_LOGGER_NAME);             
            if(serverLogsEnabled) {
                fileAppender.start();
                log.setAdditive(false);
                log.setLevel(Level.DEBUG);
                log.addAppender(fileAppender);
                logger.info("Start logging...");
            } else {
                logger.info("Stop logging...");
                log.setLevel(Level.OFF);
                log.detachAndStopAllAppenders();
            }
        }
    }

    public void setNoTLS(boolean noTLS) {
        this.noTLS = noTLS;
    }

    public void reinit() {
        if (isValidURL(beelineApiUrl)) {
            updateTechCapabilities();
            updateCapabilities();
            updateTech();
            updateTerms();
        }
    }

    public void setBeelineCloudUrl(String beelineCloudUrl) {
        this.beelineCloudUrl = (beelineCloudUrl == null) ? "" : beelineCloudUrl;
    }

    public void setBeelineCloudToken(String beelineCloudToken) {
        this.beelineCloudToken = (beelineCloudToken == null) ? "" : beelineCloudToken;
    }

    private void updateTechCapabilities() {
        CompletableFuture.runAsync(() -> {
            String path = "/api-gateway/capability/v1/tech";
            try {
                HttpsURLConnection conn = beelineApiConnection("GET", path, null, null);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    techCapabilities.set(Arrays.stream((new Gson()).fromJson(in, TechCapability[].class))
                            .collect(Collectors.toMap(TechCapability::code, Function.identity())));
                }
            } catch (IOException e) {
            }
        });
    }

    private void updateTech() {
        CompletableFuture.runAsync(() -> {
            String path = "/api-gateway/techradar/v1/tech";
            try {
                HttpsURLConnection conn = beelineApiConnection("GET", path, null, null);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    technologies.set(Arrays.stream((new Gson()).fromJson(in, Technology[].class))
                            .collect(Collectors.toMap(Technology::label, Function.identity())));
                }
            } catch (IOException e) {
            }
        });
    }

    private void updateCapabilities() {
        CompletableFuture.runAsync(() -> {
            String path = "/api-gateway/capability/v1/business";
            try {
                HttpsURLConnection conn = beelineApiConnection("GET", path, null, null);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    capabilities.set(Arrays.stream((new Gson()).fromJson(in, Capability[].class))
                            .collect(Collectors.toMap(Capability::code, Function.identity())));
                }
            } catch (IOException e) {
            }
        });
    }

    private void updateTerms() {
        CompletableFuture.runAsync(() -> {
            try {
                List<String> glossariesAList = Arrays.asList(glossaries.split(",")).stream()
                        .map(String::toLowerCase).collect(Collectors.toList());
                Map<String, Term> map = new HashMap<>();
                String path = "/api-gateway/data-model/v1/glossaries";
                HttpsURLConnection conn = beelineApiConnection("GET", path, null, null);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    Arrays.stream((new Gson()).fromJson(in, Glossary[].class))
                            .filter(g -> glossariesAList.contains(g.name().toLowerCase()))
                            .forEach(g -> {
                                try {
                                    String path0 = MessageFormat.format("/api-gateway/data-model/v1/glossaries/{0}/terms", g.id());
                                    HttpsURLConnection conn0 = beelineApiConnection("GET", path0, null, null);
                                    try (BufferedReader in0 = new BufferedReader(new InputStreamReader(conn0.getInputStream()))) {
                                        Arrays.asList((new Gson()).fromJson(in0, Term[].class)).forEach(t -> map.put(t.name(), t));
                                    }
                                } catch (IOException e0) {
                                }
                            });
                    terms.set(map);
                }
            } catch (IOException e) {
            }
        });
    }

    public void setBeelineApiUrl(String beelineApiUrl) {
        if(beelineApiUrl != null && !this.beelineApiUrl.equals(beelineApiUrl) && isValidURL(beelineApiUrl)) {
            this.beelineApiUrl = beelineApiUrl;
            if(started == false) {
                started = startTelemetry();
            }
        }
    }

    public static Custom getInstance() {
        return INSTANCE;
    }

    public void processWorkspace(Workspace workspace) {
        String cmdb = workspace.getModel().getProperties().get("workspace_cmdb");
        if(cmdb != null) {
            this.cmdb = cmdb.trim().toUpperCase();
        }
    }

    public void didChange(String uri, String text) {
        if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
            adrs.put(uri, text);
        }
    }

    public void updateAdr(String uri, String text) {
        if (uri.length() < 3 || uri.substring(uri.length() - 3).equalsIgnoreCase(".md")) {
            adrs.put(uri, text);
        }
    }

    public List<CompletionItem> calcCompletionsAdr(String uri, Position position) {
        int character = position.getCharacter();
        if (character < TECH_PATTERN.length()) {
            return Collections.emptyList();
        }
        String adr = adrs.get(uri);
        if (adr == null) {
            return Collections.emptyList();
        }
        java.util.Optional<String> line = adr.lines().skip(position.getLine()).findFirst();
        if (!line.isPresent()) {
            return Collections.emptyList();
        }
        String text = line.get().substring(character - TECH_PATTERN.length(), character);
        if (!text.toLowerCase().equals(TECH_PATTERN)) {
            return Collections.emptyList();
        }
        return technologiesCompletion();
    }    

    public List<CompletionItem> technologicalCapabilitiesCompletion() {
        return techCapabilities.get().entrySet().stream().map(e -> {
            CompletionItem item = new CompletionItem();
            CompletionItemLabelDetails details = new CompletionItemLabelDetails();
            details.setDetail(" " + e.getValue().name());
            item.setKind(CompletionItemKind.Property);
            item.setLabel(e.getKey());
            item.setLabelDetails(details);
            return item;
        }).toList();
    }

    public List<CompletionItem> businessCapabilitiesCompletion() {
        return capabilities.get().entrySet().stream().map(e -> {
            CompletionItem item = new CompletionItem();
            CompletionItemLabelDetails details = new CompletionItemLabelDetails();
            details.setDetail(" " + e.getValue().name());
            item.setKind(CompletionItemKind.Property);
            item.setLabel(e.getKey());
            item.setLabelDetails(details);
            return item;
        }).toList();
    }

    public List<CompletionItem> technologiesCompletion() {
        return technologies.get().entrySet().stream().map(e -> {
            CompletionItem item = new CompletionItem();
            CompletionItemLabelDetails details = new CompletionItemLabelDetails();
            details.setDetail(" " + e.getValue().ring().name());
            item.setKind(CompletionItemKind.Property);
            item.setLabel(e.getKey());
            item.setLabelDetails(details);
            return item;
        }).toList();
    }

    public List<CompletionItem> glossaryElementsCompletion() {
        return terms.get().entrySet().stream().map(e -> {
            CompletionItem item = new CompletionItem();
            item.setLabel(e.getKey());
            item.setKind(CompletionItemKind.Method);
            MarkupContent content = new MarkupContent(MarkupKind.MARKDOWN, e.getValue().description());
            item.setDocumentation(content);
            return item;
        }).toList();
    }

    public List<CompletionItem> beelineCloudImagesCompletion(String vegaProject) {
        if(beelineCloudUrl.isEmpty() || beelineCloudToken.isEmpty()) {
            return Collections.emptyList();
        }
        List<CompletionItem> completionItems = beelineCloudImages.getOrDefault(vegaProject, Collections.emptyList());
        if(completionItems.isEmpty()) {
            try {
                String path = MessageFormat.format("/api/v1/projects/{0}/vps/images", vegaProject);
                HttpsURLConnection conn = beelineCloudConnection("GET", path);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    completionItems = Arrays.stream((new Gson()).fromJson(in, Image[].class)).map(i -> {
                        CompletionItem item = new CompletionItem();
                        item.setLabel(i.slug());
                        item.setKind(CompletionItemKind.Method);
                        String doc = "* Name :" + i.name() + "\n"+
                        "* Distribution : " + i.distribution() + "\n" +
                        "* Version : " + i.version() + "\n" +
                        "* Min Disk Size : " + i.min_disk();
                
                        MarkupContent content = new MarkupContent(MarkupKind.MARKDOWN, doc);
                        item.setDocumentation(content);
                        return item;
                    }).toList();
                }
                conn.disconnect();
            } catch (IOException e) {
            } finally {
                if(!completionItems.isEmpty()) {
                    beelineCloudImages.put(vegaProject, completionItems);
                }
            }            
        }
        return completionItems;
    }

    public List<CompletionItem> beelineCloudFlavorsCompletion(String vegaProject) {
        if(beelineCloudToken == null || beelineCloudToken.isEmpty()) {
            return Collections.emptyList();
        }
        List<CompletionItem> completionItems = beelineCloudFlavors.getOrDefault(vegaProject, Collections.emptyList());
        if(completionItems.isEmpty()) {
            try {
                String path = MessageFormat.format("/api/v1/projects/{0}/vps/flavors", vegaProject);
                HttpsURLConnection conn = beelineCloudConnection("GET", path);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    completionItems = Arrays.stream((new Gson()).fromJson(in, Flavor[].class)).map(f -> {
                        CompletionItem item = new CompletionItem();
                        item.setLabel(f.slug());
                        item.setKind(CompletionItemKind.Method);
                        return item;
                    }).toList();
                }
                conn.disconnect();
            } catch (IOException e) {
            } finally {
                if(!completionItems.isEmpty()) {
                    beelineCloudFlavors.put(vegaProject, completionItems);
                }
            }                    
        }
        return completionItems;
    }

    public Hover businessCapabilitiesHover(String code) {
        Capability capability = capabilities.get().get(code);
        if (capability != null) {
            String name = capability.name();
            if (name != null) {
                Hover result = new Hover();
                result.setContents(new MarkupContent(MarkupKind.PLAINTEXT, name));
                if (!lastHover.equals(name)) {
                    lastHover = name;
                    hoverTelemetry();
                }
                return result;
            }
        }
        return null;
    }

    public Hover technologicalCapabilitiesHover(String code) {
        TechCapability capability = techCapabilities.get().get(code);
        if (capability != null) {
            String name = capability.name();
            if (name != null) {
                Hover result = new Hover();
                result.setContents(new MarkupContent(MarkupKind.PLAINTEXT, name));
                if (!lastHover.equals(name)) {
                    lastHover = name;
                    hoverTelemetry();
                }
                return result;
            }
        }
        return null;
    }

    public Hover glossaryElementsHover(String name) {
        Term glossaryElement = terms.get().get(name);

        if (glossaryElement != null) {
            String description = glossaryElement.description();
            if (description != null) {
                Hover result = new Hover();
                result.setContents(new MarkupContent(MarkupKind.PLAINTEXT, description));
                if (!lastHover.equals(description)) {
                    lastHover = description;
                    hoverTelemetry();
                }
                return result;
            }
        }
        return null;
    }

    public List<CompletionItem> beelineCloudRegionsCompletion(String vegaProject) {
        if (beelineCloudToken == null || beelineCloudToken.isEmpty()) {
            return Collections.emptyList();
        }
        List<CompletionItem> completionItems = beelineCloudRegions.getOrDefault(vegaProject, Collections.emptyList());
        if (completionItems.isEmpty()) {
            try {
                String path = MessageFormat.format("/api/v1/projects/{0}/vps/regions", vegaProject);
                HttpsURLConnection conn = beelineCloudConnection("GET", path);
                try (BufferedReader in = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    completionItems = Arrays.stream((new Gson()).fromJson(in, Region[].class)).map(r -> {
                        CompletionItem item = new CompletionItem();
                        item.setLabel(r.name());
                        item.setKind(CompletionItemKind.Method);
                        String doc = "* Location : " + r.location() + "\n" +
                                "* Hypervisor : " + r.hypervisor() + "\n" +
                                "* Zone : " + r.zone() + "\n" +
                                "* Priority : " + r.priority();
                        MarkupContent content = new MarkupContent(MarkupKind.MARKDOWN, doc);
                        item.setDocumentation(content);
                        return item;
                    }).toList();
                }
                conn.disconnect();
            } catch (IOException e) {
            } finally {
                if (!completionItems.isEmpty()) {
                    beelineCloudRegions.put(vegaProject, completionItems);
                }
            }
        }
        return completionItems;
    }

    public List<CompletionItem> dynamicViewCompletion(String destination, C4DocumentModel model,
            Set<C4ObjectWithContext<Element>> elements) {

        Optional<C4ObjectWithContext<Element>> element = elements.stream()
                .filter(e -> e.getIdentifier().equals(destination)).findFirst();
        if (!element.isPresent()) {
            return Collections.emptyList();
        }
        if (!(element.get().getObject() instanceof Container)) {
            return Collections.emptyList();
        }
        Container container = (Container) element.get().getObject();
        ArrayList<CompletionItem> completionItems = new ArrayList<CompletionItem>();
        container.getComponents().stream()
                .filter(c -> c.getProperties().getOrDefault("type", "").equalsIgnoreCase("capability"))
                .map(c -> c.getProperties().get("code")).filter(Objects::nonNull).forEach(c -> {
                    TechCapability capability = techCapabilities.get().get(c);

                    CompletionItem item = new CompletionItem();
                    item.setLabel(c);
                    item.setKind(CompletionItemKind.Property);
                    if (capability != null) {
                        CompletionItemLabelDetails details = new CompletionItemLabelDetails();
                        details.setDetail(" " + capability.name());
                        item.setLabelDetails(details);
                    }
                    completionItems.add(item);
                });
        return completionItems;
    }

    public Hover getPropertiesHover(List<LineToken> tokens, CursorLocation cursorAt, Position position) {
        LineToken secondToken = tokens.get(1);
        String firstTokenName = C4Utils.trimStringByString(tokens.get(0).token(), "\"")
                .toLowerCase();
        if (firstTokenName.equals("tc") && LineTokenizer.isInsideToken(cursorAt, 1)) {
            String code = secondToken.token().replaceAll("^\"|\"$", "");
            return Custom.getInstance().technologicalCapabilitiesHover(code);
        }
        if (firstTokenName.equals("parents") && LineTokenizer.isInsideToken(cursorAt, 1)) {
             String codes = secondToken.token().replaceAll("^\"|\"$", "");
            char[] chars = codes.toCharArray();

            int left = Math.min(position.getCharacter() - secondToken.start(), chars.length - 1);
            int right = Math.min(left + 1, chars.length - 1);

            for (; left > 0; left--) {
                    if (chars[left] == ',') {
                        left++;
                        break;
                    }
                }
                for (; right < chars.length; right++) {
                    if (chars[right] == ',') {
                        break;
                    }
            }

            String code = codes.substring(left, right);

            return Custom.getInstance().businessCapabilitiesHover(code);
        }
        if ((firstTokenName.equals("send") || firstTokenName.equals("return") || firstTokenName.equals("entity")) && LineTokenizer.isInsideToken(cursorAt, 1)) {
            String names = secondToken.token().replaceAll("^\"|\"$", "");
            if(!names.isEmpty()) {
                char[] chars = names.toCharArray();

                int left = Math.min(position.getCharacter() - secondToken.start(), chars.length - 1);
                int right = Math.min(left + 1, chars.length - 1);

                for (; left > 0; left--) {
                    if (chars[left] == ',') {
                        left++;
                        break;
                    }
                }
                for (; right < chars.length; right++) {
                    if (chars[right] == ',') {
                        break;
                    }
                }
                String name = names.substring(left, right);

                return Custom.getInstance().glossaryElementsHover(name);
            }
        }
        return null;
    }

    public List<CompletionItem> comleteProperties(List<LineToken> tokens, CursorLocation cursor, C4DocumentModel docModel, Position position) {
        logger.info("completeProperties");
        int lineNumberBackward = position.getLine();
        int lineNumberForward = position.getLine();
        boolean isTypeCapability = false;
        boolean isVegaProject = false;
        boolean isVm = false;
        String vegaProject = "";

        while(docModel.getSurroundingScope(lineNumberForward).equals("PropertiesDslContext")) {
            String line = docModel.getLineAt(lineNumberForward);
            if(line == null) {
                break;
            }
            List<LineToken> tokensForward = LineTokenizer.tokenize(line);
            if(tokensForward.size() == 2) {
                String firstTokenName = C4Utils.trimStringByString(tokensForward.get(0).token(), "\"").toLowerCase();
                String secondTokenValue = C4Utils.trimStringByString(tokensForward.get(1).token(), "\"").toLowerCase();
                if(firstTokenName.equals("type") && secondTokenValue.equals("capability")) {
                    isTypeCapability = true;
                }
                if (firstTokenName.equals("type") && secondTokenValue.equals("vm")) {
                    isVm = true;
                }
                if (firstTokenName.equals("vega_project")) {
                    isVegaProject = true;
                    vegaProject = secondTokenValue;
                }
            }
            lineNumberForward++;
        }
        if(isTypeCapability == false) {
            while(docModel.getSurroundingScope(lineNumberBackward).equals("PropertiesDslContext")) {
                String line = docModel.getLineAt(lineNumberBackward);
                if(line == null) {
                    break;
                }                
                List<LineToken> tokensBackward = LineTokenizer.tokenize(line);
                if(tokensBackward.size() == 2) {
                    String firstTokenName = C4Utils.trimStringByString(tokensBackward.get(0).token(), "\"").toLowerCase();
                    String secondTokenValue = C4Utils.trimStringByString(tokensBackward.get(1).token(), "\"").toLowerCase();
                    if(firstTokenName.equals("type") && secondTokenValue.equals("capability")) {
                        isTypeCapability = true;
                    }
                    if (firstTokenName.equals("type") && secondTokenValue.equals("vm")) {
                        isVm = true;
                    }
                    if (firstTokenName.equals("vega_project")) {
                        isVegaProject = true;
                        vegaProject = secondTokenValue;
                    }    
                }            
                lineNumberBackward--;
            }
        }

        LineToken firstToken = tokens.get(0);
        String firstTokenName = C4Utils.trimStringByString(firstToken.token(), "\"").toLowerCase();

        if(isTypeCapability == true) {
            if(firstTokenName.equals("code") && LineTokenizer.isInsideToken(cursor, 1)) {
                Set<Integer> idUsed = new HashSet<Integer>();
                
                docModel.getC4PropertiesByName("code").forEach(e -> {
                    try {
                        idUsed.add(Integer.parseInt(e.value()));
                    } catch (NumberFormatException nfe) {
                    }
                });

                List<String> ids = new ArrayList<String>();
                Integer i = 0, id = 0;
                while(i < 20) {
                    id++;
                    if(idUsed.contains(id)) {
                        continue;
                    }
                    ids.add(String.format("%04d", id));
                    i++;
                }
                return ids.stream().map(e -> C4CompletionItemCreator.createCompletionItem(e, CompletionItemKind.Property)).toList();
            }
            if(firstTokenName.equals("parents") && LineTokenizer.isInsideToken(cursor, 1)) {
                return businessCapabilitiesCompletion();
            }
        }

        if (isVegaProject && !vegaProject.isEmpty()) {
            if (firstTokenName.equals("region") && LineTokenizer.isInsideToken(cursor, 1)) {
                return beelineCloudRegionsCompletion(vegaProject);
            }
            
            if ((firstTokenName.equals("flavour") || firstTokenName.equals("flavor")) && LineTokenizer.isInsideToken(cursor, 1)) {
                return beelineCloudFlavorsCompletion(vegaProject);
            }
            
            if (isVm && firstTokenName.equals("image") && LineTokenizer.isInsideToken(cursor, 1)) {
                return beelineCloudImagesCompletion(vegaProject);
            }
        }

        if(firstTokenName.equals("tc") && LineTokenizer.isInsideToken(cursor, 1)) {
            return technologicalCapabilitiesCompletion();
        }

        if((firstTokenName.equals("send") || firstTokenName.equals("return") || firstTokenName.equals("entity")) && LineTokenizer.isInsideToken(cursor, 1)) {
            return glossaryElementsCompletion();
        }

        return Collections.emptyList();
    }

    public List<CompletionItem> completeContainer(List<LineToken> tokens, CursorLocation cursor, C4DocumentModel model) {
        logger.info("completeTechnology");
        if(tokens.size() == 5) {
            String elementName = C4Utils.trimStringByString(tokens.get(0).token(), "\"").toLowerCase();
            if((elementName.equals("component") || elementName.equals("container")) && LineTokenizer.isInsideToken(cursor, 3)) {
                return technologiesCompletion();
            }
        } else if(tokens.size() == 7) {
            String elementName = C4Utils.trimStringByString(tokens.get(2).token(), "\"").toLowerCase();
            if((elementName.equals("component") || elementName.equals("container")) && LineTokenizer.isInsideToken(cursor, 5)) {
                return technologiesCompletion();
            }            
        } else if(tokens.size() == 2) {
            String elementName = C4Utils.trimStringByString(tokens.get(0).token(), "\"").toLowerCase();
            if(elementName.equals("technology") && LineTokenizer.isInsideToken(cursor, 1)) {
                return technologiesCompletion();
            }
        }
        if(tokens.size() > 1 && tokens.get(1).token().equals(LineTokenizer.TOKEN_EXPR_RELATIONSHIP)) {
            if(LineTokenizer.isBetweenTokens(cursor, 1, 2)) {
                return C4CompletionItemCreator.identifierCompletion(model.getIdentifiers());
            }
            if(LineTokenizer.isInsideToken(cursor, 2)) {
                return C4CompletionItemCreator.identifierCompletion(model.getIdentifiers()).stream()
                        .filter( item -> item.getLabel().startsWith(tokens.get(2).token()))
                        .collect(Collectors.toList());
            }
        }
        return Collections.emptyList();
    }
    
    public void closeScope(C4CompletionScope scope, C4DocumentModel model) {

        if(!isValidURL(beelineApiUrl) || beelineApiKey.isEmpty() || beelineApiSecret.isEmpty()) {
            return;
        }

        if (scope.name().equals("DeploymentEnvironmentDslContext")) {
            String line = model.getLineAt(scope.start() - 1);
            List<LineToken> tokens = LineTokenizer.tokenize(line);
            if (tokens.size() == 3) {
                Command commandStructurizr = new Command("$(link-external) Export Environment", "c4.export.deployment");
                String name = C4Utils.trimStringByString(tokens.get(1).token(), "\"");
                commandStructurizr.setArguments(Arrays.asList(name));
                int pos = C4Utils.findFirstNonWhitespace(line, 0, true);
                Range range = new Range(new Position(scope.start() - 1, pos), new Position(scope.start() - 1, pos));
                model.addCodeLens(new CodeLens(range, commandStructurizr, null));
            }
        } else if(scope.name().equals("PropertiesDslContext")) {
            int lineNumber = scope.start();
            boolean isApi = false;
            boolean isSlaPresent = false;
            String apiUrl = "";

            for(int i = lineNumber;i < scope.end();i++) {
                String line = model.getLineAt(i - 1);
                List<LineToken> tokens = LineTokenizer.tokenize(line);
                if(tokens.size() == 2) {
                    String name = C4Utils.trimStringByString(tokens.get(0).token(), "\"").toLowerCase();
                    String value = C4Utils.trimStringByString(tokens.get(1).token(), "\"").toLowerCase();
                    if(name.equals("type") && value.equals("api")) {
                        isApi = true;
                    }
                    if(name.equals("api_url")) {
                        apiUrl = value;
                    }
                    if(value.contains("rps") && value.contains("latency") && value.contains("error_rate")) {
                        isSlaPresent = true;
                    }
                }
            }
            if(isApi == true && isSlaPresent == false && apiUrl.isBlank() == false) {
                List<LineToken> tokens;
                int i = 0;
                do {
                    i++;
                    String tokensAtlastLine = model.getLineAt(scope.end() - (i + 1));
                    tokens = LineTokenizer.tokenize(tokensAtlastLine);
                } while(tokens.size() != 2);

                int lastLine = scope.end() - i;
                int startLine = tokens.get(0).start();
                Command commandStructurizr = new Command("$(link-external) Insert SLA", "c4.insert.sla");
                commandStructurizr.setArguments(Arrays.asList(apiUrl, lastLine, startLine));
                String line = model.getLineAt(lineNumber - 1);
                int pos = C4Utils.findFirstNonWhitespace(line, 0, true);

                Range range = new Range(new Position(lineNumber - 1, pos), new Position(lineNumber - 1, pos));
                model.addCodeLens(new CodeLens(range, commandStructurizr, null));
            }
        }
    }

	public void snippetTelemetry(String templateId) {
        String message = MessageFormat.format("'{'\"version\": \"{0}\", \"action\": \"template\", \"template_id\": \"{1}\", \"user\": \"{2}\", \"cmdb\": \"{3}\"'}'", ver, templateId, username, cmdb);
        CompletableFuture.runAsync(() -> sendTelemetry(message));
	}

	public void deploymentTelemetry() {
        String message = MessageFormat.format("'{'\"version\": \"{0}\", \"action\": \"deployment\", \"user\": \"{1}\", \"cmdb\": \"{2}\"'}'", ver, username, cmdb);
        CompletableFuture.runAsync(() -> sendTelemetry(message));
	}    

    public void completionTelemety() {
        String message = MessageFormat.format("'{'\"version\": \"{0}\", \"action\": \"autocomplite\", \"user\": \"{1}\", \"cmdb\": \"{2}\"'}'", ver, username, cmdb);
        CompletableFuture.runAsync(() -> sendTelemetry(message));
    }

    public boolean startTelemetry() {
       String message = MessageFormat.format("'{'\"version\": \"{0}\", \"action\": \"start\", \"user\": \"{1}\", \"cmdb\": \"{2}\"'}'", ver, username, cmdb);
       return sendTelemetry(message);
    }

    public void hoverTelemetry() {
        String message = MessageFormat.format(
                "'{'\"version\": \"{0}\", \"action\": \"hover\", \"user\": \"{1}\", \"cmdb\": \"{2}\"'}'", ver,
                username, cmdb);
        CompletableFuture.runAsync(() -> sendTelemetry(message));
    }

    private boolean sendTelemetry(String message) {
        try {
            String path = "/api/v1/telemetry/c4plugin/start";
            HttpsURLConnection conn = beelineApiConnection("POST", path, message, "application/json");
            conn.setRequestProperty("Accept", "text/plain");

            conn.setDoOutput(true);
            OutputStream outStream = conn.getOutputStream();
            OutputStreamWriter outStreamWriter = new OutputStreamWriter(outStream, "UTF-8");
            outStreamWriter.write(message);
            outStreamWriter.flush();
            outStreamWriter.close();
            outStream.close();

            conn.getResponseCode();
            conn.getResponseMessage();

            conn.disconnect();
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}