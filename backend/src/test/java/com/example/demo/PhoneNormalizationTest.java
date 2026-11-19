package com.example.demo;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PhoneNormalizationTest {

    @Test
    void testNormalizePhone() {
        assertEquals("0988888888", WorkshopService.normalizePhone("0988888888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("0988 888 888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("0988.888.888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("0988-888-888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("+84988888888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("+84 988 888 888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("+84.988.888.888"));
        assertEquals("0988888888", WorkshopService.normalizePhone("84988888888"));
        assertEquals("", WorkshopService.normalizePhone(null));
        assertEquals("", WorkshopService.normalizePhone("   "));
    }
}
