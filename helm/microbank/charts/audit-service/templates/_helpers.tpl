{{- define "audit-service.fullname" -}}
{{- printf "%s-audit-service" .Release.Name -}}
{{- end -}}

{{- define "audit-service.labels" -}}
app.kubernetes.io/name: audit-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "audit-service.selectorLabels" -}}
app.kubernetes.io/name: audit-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
