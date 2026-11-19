package com.example.demo;

import jakarta.validation.Valid;
import java.security.Principal;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class WorkshopController {
    private final WorkshopService workshop;
    public WorkshopController(WorkshopService workshop) { this.workshop = workshop; }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) { return Map.of("token", token.getToken(), "headerName", token.getHeaderName()); }

    @GetMapping("/state")
    public Map<String, Object> state(Principal principal) { return workshop.state(principal); }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public void register(@Valid @RequestBody ApiModels.AccountInput input) { workshop.createAccount(input, false); }

    @PostMapping("/accounts")
    @PreAuthorize("hasRole('MANAGER')")
    @ResponseStatus(HttpStatus.CREATED)
    public void createAccount(@Valid @RequestBody ApiModels.AccountInput input) { workshop.createAccount(input, true); }

    @PostMapping("/services")
    @PreAuthorize("hasRole('MANAGER')")
    @ResponseStatus(HttpStatus.CREATED)
    public void createService(@Valid @RequestBody ApiModels.ServiceInput input) { workshop.saveService(null, input); }

    @PutMapping("/services/{id}")
    @PreAuthorize("hasRole('MANAGER')")
    public void updateService(@PathVariable String id, @Valid @RequestBody ApiModels.ServiceInput input) { workshop.saveService(id, input); }

    @PutMapping("/capacity")
    @PreAuthorize("hasRole('MANAGER')")
    public void updateCapacity(@Valid @RequestBody ApiModels.CapacityInput input) { workshop.setCapacity(input.capacity()); }

    @PostMapping("/appointments")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Long> book(Principal principal, @Valid @RequestBody ApiModels.BookingInput input) {
        return Map.of("id", workshop.book(principal, input));
    }

    @PutMapping("/appointments/{id}/schedule")
    public void reschedule(Principal principal, @PathVariable Long id, @Valid @RequestBody ApiModels.RescheduleInput input) {
        workshop.reschedule(principal, id, input);
    }

    @PutMapping("/appointments/{id}/status")
    public void status(Principal principal, @PathVariable Long id, @Valid @RequestBody ApiModels.StatusInput input) {
        workshop.changeStatus(principal, id, input);
    }

    @RestControllerAdvice
    public static class Errors {
        @ExceptionHandler(ResponseStatusException.class)
        ResponseEntity<Map<String, String>> status(ResponseStatusException ex) {
            return ResponseEntity.status(ex.getStatusCode()).body(Map.of("message", ex.getReason() == null ? "Yêu cầu không hợp lệ" : ex.getReason()));
        }
        @ExceptionHandler(MethodArgumentNotValidException.class)
        ResponseEntity<Map<String, String>> validation(MethodArgumentNotValidException ex) {
            var field = ex.getBindingResult().getFieldError();
            if (field == null) {
                return ResponseEntity.badRequest().body(Map.of("message", "Thông tin không hợp lệ"));
            }
            String fieldName = field.getField();
            String message = switch (fieldName) {
                case "phone" -> "Số điện thoại không hợp lệ (yêu cầu 10 chữ số bắt đầu bằng số 0)";
                case "password" -> "Mật khẩu phải từ 8 đến 72 ký tự";
                case "name", "customerName" -> "Họ và tên không được để trống";
                case "licensePlate" -> "Biển số xe không hợp lệ (từ 4 đến 30 ký tự)";
                case "carModel" -> "Dòng xe không được để trống";
                case "date" -> "Ngày hẹn không hợp lệ";
                case "slot" -> "Khung giờ hẹn không hợp lệ";
                case "serviceIds" -> "Vui lòng chọn ít nhất một dịch vụ";
                case "capacity" -> "Công suất xưởng phải từ 1 đến 5 khoang";
                case "code" -> "Mã dịch vụ không hợp lệ";
                case "category" -> "Danh mục dịch vụ không được để trống";
                case "duration" -> "Thời gian thực hiện dịch vụ không hợp lệ";
                case "price" -> "Giá dịch vụ không hợp lệ";
                case "status" -> "Trạng thái lịch hẹn không hợp lệ";
                default -> "Thông tin không hợp lệ: " + fieldName;
            };
            return ResponseEntity.badRequest().body(Map.of("message", message));
        }
        @ExceptionHandler(DataIntegrityViolationException.class)
        ResponseEntity<Map<String, String>> duplicate(DataIntegrityViolationException ex) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "Dữ liệu bị trùng hoặc không hợp lệ"));
        }
    }
}
