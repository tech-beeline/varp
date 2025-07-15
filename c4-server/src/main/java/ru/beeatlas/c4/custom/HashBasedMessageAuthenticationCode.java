package ru.beeatlas.c4.custom;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

class HashBasedMessageAuthenticationCode {

    private static final String HMAC_SHA256_ALGORITHM = "HmacSHA256";
    private static final String MD5_ALGORITHM = "MD5";

    private String apiSecret;

    HashBasedMessageAuthenticationCode(String apiSecret) {
        this.apiSecret = apiSecret;
    }

    public static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    String generate(String content) throws NoSuchAlgorithmException, InvalidKeyException {
        SecretKeySpec signingKey = new SecretKeySpec(apiSecret.getBytes(), HMAC_SHA256_ALGORITHM);
        Mac mac = Mac.getInstance(HMAC_SHA256_ALGORITHM);
        mac.init(signingKey);
        byte[] rawHmac = mac.doFinal(content.getBytes());
        return HexFormat.of().withLowerCase().formatHex(rawHmac);
    }

    public static String md5(String input) throws NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance(MD5_ALGORITHM);
        byte[] messageDigest = md.digest(input.getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().withLowerCase().formatHex(messageDigest);
    }    

}