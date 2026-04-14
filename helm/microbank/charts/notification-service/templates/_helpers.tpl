{{- define "notification-service.fullname" -}}
{{- printf "%s-notification-service" .Release.Name -}}
{{- end -}}

{{- define "notification-service.labels" -}}
app.kubernetes.io/name: notification-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "notification-service.selectorLabels" -}}
app.kubernetes.io/name: notification-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
